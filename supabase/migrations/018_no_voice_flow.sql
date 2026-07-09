-- Supabase SQL Editor에서 Run 하세요.
-- Phase 4-11: No Voice 수락/거절 흐름 개선
-- 016_penalty_system.sql 실행 후 적용

alter table public.duo_matches
  add column if not exists user_a_accepted_no_voice boolean not null default false,
  add column if not exists user_b_accepted_no_voice boolean not null default false;

comment on column public.duo_matches.user_a_accepted_no_voice is 'user_a가 상대 no voice 선택을 수락함';
comment on column public.duo_matches.user_b_accepted_no_voice is 'user_b가 상대 no voice 선택을 수락함';

-- 상대 no voice 선택을 수락 (페널티 없음)
create or replace function public.accept_partner_no_voice(p_user_id uuid, p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_user_a boolean;
  v_my_voice text;
  v_partner_voice text;
begin
  if p_user_id is null or p_match_id is null then
    raise exception 'user_id and match_id required';
  end if;

  select
    (user_a_id = p_user_id),
    case when user_a_id = p_user_id then user_a_voice_preference else user_b_voice_preference end,
    case when user_a_id = p_user_id then user_b_voice_preference else user_a_voice_preference end
  into v_is_user_a, v_my_voice, v_partner_voice
  from public.duo_matches
  where id = p_match_id
    and status = 'active'
    and (user_a_id = p_user_id or user_b_id = p_user_id);

  if v_my_voice is null then
    raise exception 'match_not_found';
  end if;

  -- 상대만 no voice를 선택한 경우에만 수락 가능
  if v_partner_voice <> 'none' or v_my_voice = 'none' then
    raise exception 'no_voice_accept_not_allowed';
  end if;

  update public.duo_matches
  set
    user_a_accepted_no_voice = case when v_is_user_a then true else user_a_accepted_no_voice end,
    user_b_accepted_no_voice = case when not v_is_user_a then true else user_b_accepted_no_voice end
  where id = p_match_id
    and status = 'active';
end;
$$;

revoke all on function public.accept_partner_no_voice(uuid, uuid) from public;
revoke all on function public.accept_partner_no_voice(uuid, uuid) from authenticated;
grant execute on function public.accept_partner_no_voice(uuid, uuid) to service_role;

-- no voice 거절(매칭 종료) 시 페널티 제외
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

  -- 상대 no voice → 내가 거절하고 나감 = 페널티 없음
  if v_partner_voice = 'none' and v_my_voice is not null and v_my_voice <> 'none' then
    v_skip_penalty := true;
  end if;

  update public.duo_matches
  set
    status = 'completed',
    cancel_reason = case when v_skip_penalty then 'no_voice_declined' else 'manual' end
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
