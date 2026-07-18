-- Supabase SQL Editor에서 Run 하세요.
-- 028_premium_match_prefs.sql 실행 후 적용
--
-- 버그: 탭 닫기(sendBeacon)가 두 번 오면 같은 매치에 페널티가 2번 적용됨
--   → 4회(5분)와 5회(15분)가 같은 시각에 동시에 찍힘
-- 수정: 유저+매치당 페널티 1회만, 취소가 실제로 됐을 때만 부여

-- 1) 같은 유저·같은 매치 페널티 1건만 (이미 중복이 있으면 인덱스 생성 실패할 수 있음
--    → 중복이 있으면 아래 cleanup 후 인덱스 생성)
delete from public.duo_match_penalties a
using public.duo_match_penalties b
where a.match_id is not null
  and a.match_id = b.match_id
  and a.user_id = b.user_id
  and a.created_at > b.created_at;

create unique index if not exists duo_match_penalties_user_match_uidx
  on public.duo_match_penalties (user_id, match_id)
  where match_id is not null;

-- 2) apply_match_penalty — 프로필 잠금 + 매치당 1회
create or replace function public.apply_match_penalty(
  p_user_id uuid,
  p_match_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_count integer;
  v_cooldown timestamptz;
  v_trust_deduction integer := 8;
begin
  if p_user_id is null then
    return;
  end if;

  if p_reason is null or p_reason not in ('manual_cancel', 'offline_leave') then
    raise exception 'invalid penalty reason';
  end if;

  perform set_config('app.writing_reputation', 'true', true);

  -- 같은 유저 페널티를 한 줄로 처리 (동시 호출 직렬화)
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then
    return;
  end if;

  -- 같은 매치에 이미 페널티가 있으면 스킵 (5분+15분 동시 찍힘 방지)
  if p_match_id is not null and exists (
    select 1
    from public.duo_match_penalties
    where user_id = p_user_id
      and match_id = p_match_id
  ) then
    return;
  end if;

  update public.profiles
  set
    penalty_count = penalty_count + 1,
    penalty_deduction = penalty_deduction + v_trust_deduction,
    updated_at = now()
  where id = p_user_id
  returning penalty_count into v_new_count;

  if v_new_count is null then
    return;
  end if;

  perform public.apply_reputation_score(p_user_id);

  -- 1~3: 경고 / 4: 5분 / 5+: 15분
  if v_new_count >= 5 then
    v_cooldown := now() + interval '15 minutes';
  elsif v_new_count = 4 then
    v_cooldown := now() + interval '5 minutes';
  else
    v_cooldown := null;
  end if;

  if v_cooldown is not null then
    update public.profiles
    set cooldown_until = v_cooldown
    where id = p_user_id;
  end if;

  insert into public.duo_match_penalties (
    user_id, match_id, reason, penalty_count_after, cooldown_until
  )
  values (
    p_user_id, p_match_id, p_reason, v_new_count, v_cooldown
  );
end;
$$;

revoke all on function public.apply_match_penalty(uuid, uuid, text) from public;
revoke all on function public.apply_match_penalty(uuid, uuid, text) from authenticated;
revoke all on function public.apply_match_penalty(uuid, uuid, text) from anon;
grant execute on function public.apply_match_penalty(uuid, uuid, text) to service_role;

-- 3) 오프라인 취소 — UPDATE가 실제로 매치를 취소했을 때만 페널티
create or replace function public.cancel_duo_match_for_offline_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match_id uuid;
begin
  if p_user_id is null then
    return;
  end if;

  -- 활성 매치만 잡고 취소. 이미 cancelled면 returning null → 페널티 안 줌
  update public.duo_matches
  set
    status = 'cancelled',
    cancel_reason = 'partner_offline',
    offline_user_id = p_user_id
  where status in ('active', 'in_game')
    and (user_a_id = p_user_id or user_b_id = p_user_id)
  returning id into v_match_id;

  if v_match_id is not null then
    perform public.apply_match_penalty(p_user_id, v_match_id, 'offline_leave');
  end if;
end;
$$;

revoke all on function public.cancel_duo_match_for_offline_user(uuid) from public;
revoke all on function public.cancel_duo_match_for_offline_user(uuid) from authenticated;
revoke all on function public.cancel_duo_match_for_offline_user(uuid) from anon;
grant execute on function public.cancel_duo_match_for_offline_user(uuid) to service_role;
