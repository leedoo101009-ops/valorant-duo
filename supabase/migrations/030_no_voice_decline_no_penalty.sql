-- Supabase SQL Editor에서 Run 하세요.
-- 029_penalty_idempotent.sql 실행 후 적용
--
-- No Voice 안내에서 「매칭 취소」버튼 → 페널티 없음
-- 같은 상황에서 탭 닫기/사이트 이탈 → 기존 offline_leave 페널티 유지
--   (cancel_duo_match_for_offline_user 는 그대로 페널티 부여)

-- 1) No Voice 거절 전용 RPC (절대 페널티 없음)
create or replace function public.decline_partner_no_voice(
  p_user_id uuid,
  p_match_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_my_voice text;
  v_partner_voice text;
  v_found boolean;
begin
  if p_user_id is null or p_match_id is null then
    raise exception 'user_id and match_id required';
  end if;

  select
    case when user_a_id = p_user_id then user_a_voice_preference else user_b_voice_preference end,
    case when user_a_id = p_user_id then user_b_voice_preference else user_a_voice_preference end
  into v_my_voice, v_partner_voice
  from public.duo_matches
  where id = p_match_id
    and status = 'active'
    and match_phase = 'connecting'
    and (user_a_id = p_user_id or user_b_id = p_user_id);

  if v_my_voice is null then
    raise exception 'match_not_found';
  end if;

  -- 상대만 no voice인 거절 상황인지 확인
  if v_partner_voice is distinct from 'none'
    or v_my_voice = 'none' then
    raise exception 'no_voice_decline_not_allowed';
  end if;

  update public.duo_matches
  set
    status = 'cancelled',
    cancel_reason = 'no_voice_declined',
    cancelled_by_user_id = p_user_id
  where id = p_match_id
    and status = 'active'
    and (user_a_id = p_user_id or user_b_id = p_user_id)
  returning true into v_found;

  if not v_found then
    raise exception 'match_not_found';
  end if;

  -- 페널티 없음 (의도적으로 apply_match_penalty 호출 안 함)
end;
$$;

revoke all on function public.decline_partner_no_voice(uuid, uuid) from public;
revoke all on function public.decline_partner_no_voice(uuid, uuid) from authenticated;
revoke all on function public.decline_partner_no_voice(uuid, uuid) from anon;
grant execute on function public.decline_partner_no_voice(uuid, uuid) to service_role;

-- 2) dismiss 경로 안전망 — 상대 no voice 거절이면 페널티 스킵 (구 클라이언트 대비)
create or replace function public.dismiss_duo_match(p_user_id uuid, p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_in_game_at timestamptz;
  v_found boolean;
  v_my_voice text;
  v_partner_voice text;
  v_skip_penalty boolean := false;
begin
  if p_user_id is null or p_match_id is null then
    raise exception 'user_id and match_id required';
  end if;

  select
    in_game_at,
    case when user_a_id = p_user_id then user_a_voice_preference else user_b_voice_preference end,
    case when user_a_id = p_user_id then user_b_voice_preference else user_a_voice_preference end
  into v_in_game_at, v_my_voice, v_partner_voice
  from public.duo_matches
  where id = p_match_id
    and status in ('active', 'in_game')
    and (user_a_id = p_user_id or user_b_id = p_user_id);

  -- 상대 no voice → 거절하고 닫기 = 페널티 없음
  if v_partner_voice = 'none'
    and v_my_voice is not null
    and v_my_voice <> 'none' then
    v_skip_penalty := true;
  end if;

  update public.duo_matches
  set
    status = case when v_skip_penalty then 'cancelled' else 'completed' end,
    cancel_reason = case when v_skip_penalty then 'no_voice_declined' else 'manual' end,
    cancelled_by_user_id = case when v_skip_penalty then p_user_id else cancelled_by_user_id end
  where id = p_match_id
    and status in ('active', 'in_game')
    and (user_a_id = p_user_id or user_b_id = p_user_id)
  returning true into v_found;

  if not v_found then
    raise exception 'match_not_found';
  end if;

  if v_in_game_at is null and not v_skip_penalty then
    perform public.apply_match_penalty(p_user_id, p_match_id, 'manual_cancel');
  end if;
end;
$$;

revoke all on function public.dismiss_duo_match(uuid, uuid) from public;
revoke all on function public.dismiss_duo_match(uuid, uuid) from authenticated;
revoke all on function public.dismiss_duo_match(uuid, uuid) from anon;
grant execute on function public.dismiss_duo_match(uuid, uuid) to service_role;

-- 3) setup 취소도 같은 no-voice 거절이면 페널티 스킵
create or replace function public.cancel_duo_match_setup(p_user_id uuid, p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_found boolean;
  v_my_voice text;
  v_partner_voice text;
  v_skip_penalty boolean := false;
begin
  if p_user_id is null or p_match_id is null then
    raise exception 'user_id and match_id required';
  end if;

  select
    case when user_a_id = p_user_id then user_a_voice_preference else user_b_voice_preference end,
    case when user_a_id = p_user_id then user_b_voice_preference else user_a_voice_preference end
  into v_my_voice, v_partner_voice
  from public.duo_matches
  where id = p_match_id
    and status = 'active'
    and match_phase in ('connecting', 'setup')
    and (user_a_id = p_user_id or user_b_id = p_user_id);

  if v_partner_voice = 'none'
    and v_my_voice is not null
    and v_my_voice <> 'none' then
    v_skip_penalty := true;
  end if;

  update public.duo_matches
  set
    status = 'cancelled',
    cancel_reason = case when v_skip_penalty then 'no_voice_declined' else 'setup_cancelled' end,
    cancelled_by_user_id = p_user_id
  where id = p_match_id
    and status = 'active'
    and match_phase in ('connecting', 'setup')
    and (user_a_id = p_user_id or user_b_id = p_user_id)
  returning true into v_found;

  if not v_found then
    raise exception 'match_not_found';
  end if;

  if not v_skip_penalty then
    perform public.apply_match_penalty(p_user_id, p_match_id, 'manual_cancel');
  end if;
end;
$$;

revoke all on function public.cancel_duo_match_setup(uuid, uuid) from public;
revoke all on function public.cancel_duo_match_setup(uuid, uuid) from authenticated;
revoke all on function public.cancel_duo_match_setup(uuid, uuid) from anon;
grant execute on function public.cancel_duo_match_setup(uuid, uuid) to service_role;
