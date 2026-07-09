-- Supabase SQL Editor에서 Run 하세요.
-- Phase 4-10: 이탈 페널티 시스템
-- 015_match_reviews.sql 실행 후 적용

-- 1) profiles에 페널티 컬럼 추가
alter table public.profiles
  add column if not exists penalty_count integer not null default 0
    check (penalty_count >= 0),
  add column if not exists penalty_deduction integer not null default 0
    check (penalty_deduction >= 0),
  add column if not exists cooldown_until timestamptz;

comment on column public.profiles.penalty_count is '이탈 횟수 (1-3: 경고, 4: 5분 쿨다운, 5+: 15분 쿨다운)';
comment on column public.profiles.penalty_deduction is '누적 신뢰도 감점 (리뷰 재계산 시에도 유지되도록 별도 보관)';
comment on column public.profiles.cooldown_until is '큐 입장 불가 종료 시각 (null이면 제한 없음)';

-- 1-2) 신뢰도 재계산: 리뷰 평균 - 누적 페널티 감점 (0~100 클램프)
-- 보안/무결성: apply_match_penalty와 recalculate_user_reputation이
--   동일한 공식을 쓰도록 단일 함수로 통일 → 리뷰가 들어와도 페널티 감점이 사라지지 않음.
create or replace function public.apply_reputation_score(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_avg numeric;
  v_deduction integer;
begin
  select coalesce(avg(review_score), 70)
  into v_avg
  from public.duo_match_reviews
  where reviewee_id = p_user_id;

  select penalty_deduction
  into v_deduction
  from public.profiles
  where id = p_user_id;

  update public.profiles
  set
    trust_score = greatest(0, least(100, round(v_avg)::integer - coalesce(v_deduction, 0)))::smallint,
    updated_at = now()
  where id = p_user_id;
end;
$$;

revoke all on function public.apply_reputation_score(uuid) from public;
revoke all on function public.apply_reputation_score(uuid) from authenticated;
grant execute on function public.apply_reputation_score(uuid) to service_role;

-- 1-3) 리뷰 재계산 함수를 페널티 반영 버전으로 교체
create or replace function public.recalculate_user_reputation(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  select count(*)
  into v_count
  from public.duo_match_reviews
  where reviewee_id = p_user_id;

  update public.profiles
  set review_count = v_count
  where id = p_user_id;

  -- 신뢰도는 리뷰 평균 - 누적 페널티 감점으로 재계산
  perform public.apply_reputation_score(p_user_id);
end;
$$;

revoke all on function public.recalculate_user_reputation(uuid) from public;
revoke all on function public.recalculate_user_reputation(uuid) from authenticated;
grant execute on function public.recalculate_user_reputation(uuid) to service_role;

-- 2) 페널티 기록 테이블
create table if not exists public.duo_match_penalties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  match_id uuid references public.duo_matches (id) on delete set null,
  reason text not null check (reason in ('manual_cancel', 'offline_leave')),
  penalty_count_after integer not null,
  cooldown_until timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists duo_match_penalties_user_idx
  on public.duo_match_penalties (user_id, created_at desc);

comment on table public.duo_match_penalties is '이탈 페널티 기록';

alter table public.duo_match_penalties enable row level security;

-- 본인 기록만 조회
create policy "duo_match_penalties_select_own"
  on public.duo_match_penalties
  for select
  to authenticated
  using (auth.uid() = user_id);

revoke all on table public.duo_match_penalties from authenticated;
grant select on table public.duo_match_penalties to authenticated;

-- 3) 페널티 부여 RPC
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

  -- 페널티 횟수 증가 + 누적 감점 반영 (trust_score는 아래 재계산으로 통일)
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

  -- 리뷰 평균 - 누적 감점으로 신뢰도 재계산 (리뷰가 없어도 기본 70에서 차감)
  perform public.apply_reputation_score(p_user_id);

  -- 쿨다운 계산
  if v_new_count >= 5 then
    v_cooldown := now() + interval '15 minutes';
  elsif v_new_count = 4 then
    v_cooldown := now() + interval '5 minutes';
  else
    -- 1~3회: 경고만, 쿨다운 없음
    v_cooldown := null;
  end if;

  -- 쿨다운 적용
  if v_cooldown is not null then
    update public.profiles
    set cooldown_until = v_cooldown
    where id = p_user_id;
  end if;

  -- 기록 남기기
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
grant execute on function public.apply_match_penalty(uuid, uuid, text) to service_role;

-- 4) 큐 입장 시 쿨다운 체크를 포함한 join_match_queue 업데이트
create or replace function public.join_match_queue(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cooldown_until timestamptz;
begin
  if p_user_id is null then
    raise exception 'user_id required';
  end if;

  perform public.cleanup_stale_queue_entries();

  if not exists (
    select 1 from public.profiles
    where id = p_user_id
  ) then
    raise exception 'profile_not_found';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_user_id and riot_id is not null
  ) then
    raise exception 'riot_required';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_user_id
      and last_seen_at > now() - interval '90 seconds'
  ) then
    raise exception 'offline_required';
  end if;

  -- 쿨다운 검증
  select cooldown_until into v_cooldown_until
  from public.profiles
  where id = p_user_id;

  if v_cooldown_until is not null and v_cooldown_until > now() then
    -- 쿨다운 종료 시각을 ISO 형식으로 에러 메시지에 포함
    raise exception 'match_cooldown_active:%', to_char(v_cooldown_until at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  end if;

  perform set_config('app.match_queue_write', 'true', true);

  insert into public.match_queue_entries (user_id, joined_at)
  values (p_user_id, now())
  on conflict (user_id) do update
  set joined_at = excluded.joined_at;

  perform set_config('app.match_queue_write', 'false', true);
end;
$$;

revoke all on function public.join_match_queue(uuid) from public;
revoke all on function public.join_match_queue(uuid) from authenticated;
revoke all on function public.join_match_queue(uuid) from anon;
grant execute on function public.join_match_queue(uuid) to service_role;

-- 5) 이탈 시 페널티 적용 (tab close / heartbeat 소실)
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

  -- 이탈한 매칭 ID 조회 (active/in_game)
  select id into v_match_id
  from public.duo_matches
  where status in ('active', 'in_game')
    and (user_a_id = p_user_id or user_b_id = p_user_id)
  limit 1;

  update public.duo_matches
  set
    status = 'cancelled',
    cancel_reason = 'partner_offline',
    offline_user_id = p_user_id
  where status in ('active', 'in_game')
    and (user_a_id = p_user_id or user_b_id = p_user_id);

  -- 매칭이 실제로 있었을 때만 페널티 부여
  if v_match_id is not null then
    perform public.apply_match_penalty(p_user_id, v_match_id, 'offline_leave');
  end if;
end;
$$;

-- 6) 취소 버튼 페널티 적용
create or replace function public.cancel_duo_match_setup(p_user_id uuid, p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_found boolean;
begin
  if p_user_id is null or p_match_id is null then
    raise exception 'user_id and match_id required';
  end if;

  update public.duo_matches
  set
    status = 'cancelled',
    cancel_reason = 'setup_cancelled',
    cancelled_by_user_id = p_user_id
  where id = p_match_id
    and status = 'active'
    and match_phase in ('connecting', 'setup')
    and (user_a_id = p_user_id or user_b_id = p_user_id)
  returning true into v_found;

  if not v_found then
    raise exception 'match_not_found';
  end if;

  -- 직접 취소한 사람에게 페널티
  perform public.apply_match_penalty(p_user_id, p_match_id, 'manual_cancel');
end;
$$;

revoke all on function public.cancel_duo_match_setup(uuid, uuid) from public;
revoke all on function public.cancel_duo_match_setup(uuid, uuid) from authenticated;
revoke all on function public.cancel_duo_match_setup(uuid, uuid) from anon;
grant execute on function public.cancel_duo_match_setup(uuid, uuid) to service_role;

-- 6-2) 종료(dismiss) 페널티 — 게임 시작 전 종료는 이탈로 간주
-- 보안: dismiss 경로로 취소 페널티를 우회하지 못하도록 막음.
--   in_game_at IS NULL  → 아직 게임 시작 전인데 나감 = 이탈 → 페널티
--   in_game_at IS NOT NULL → 게임까지 정상 진행 후 종료 = 페널티 없음(리뷰 흐름으로 이어짐)
create or replace function public.dismiss_duo_match(p_user_id uuid, p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_in_game_at timestamptz;
  v_found boolean;
begin
  if p_user_id is null or p_match_id is null then
    raise exception 'user_id and match_id required';
  end if;

  -- 업데이트 전에 게임 시작 여부를 먼저 확보 (동일 매칭 참여자만)
  select in_game_at
  into v_in_game_at
  from public.duo_matches
  where id = p_match_id
    and status in ('active', 'in_game')
    and (user_a_id = p_user_id or user_b_id = p_user_id);

  update public.duo_matches
  set
    status = 'completed',
    cancel_reason = 'manual'
  where id = p_match_id
    and status in ('active', 'in_game')
    and (user_a_id = p_user_id or user_b_id = p_user_id)
  returning true into v_found;

  if not v_found then
    raise exception 'match_not_found';
  end if;

  -- 게임 시작 전에 나갔다면 취소와 동일하게 페널티 부여
  if v_in_game_at is null then
    perform public.apply_match_penalty(p_user_id, p_match_id, 'manual_cancel');
  end if;
end;
$$;

revoke all on function public.dismiss_duo_match(uuid, uuid) from public;
revoke all on function public.dismiss_duo_match(uuid, uuid) from authenticated;
revoke all on function public.dismiss_duo_match(uuid, uuid) from anon;
grant execute on function public.dismiss_duo_match(uuid, uuid) to service_role;

-- 7) 페널티 기록 조회 RPC (본인 기록, 최근 20건)
create or replace function public.get_my_penalties(p_user_id uuid)
returns table (
  id uuid,
  match_id uuid,
  reason text,
  penalty_count_after integer,
  cooldown_until timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.match_id, p.reason, p.penalty_count_after, p.cooldown_until, p.created_at
  from public.duo_match_penalties p
  where p.user_id = p_user_id
  order by p.created_at desc
  limit 20;
$$;

revoke all on function public.get_my_penalties(uuid) from public;
revoke all on function public.get_my_penalties(uuid) from authenticated;
grant execute on function public.get_my_penalties(uuid) to service_role;

-- 8) 쿨다운 상태 조회 RPC (프론트에서 실시간 확인용 — authenticated 허용)
create or replace function public.get_my_cooldown_status(p_user_id uuid)
returns table (
  penalty_count integer,
  cooldown_until timestamptz,
  is_cooling_down boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    penalty_count,
    cooldown_until,
    (cooldown_until is not null and cooldown_until > now()) as is_cooling_down
  from public.profiles
  where id = p_user_id;
$$;

revoke all on function public.get_my_cooldown_status(uuid) from public;
revoke all on function public.get_my_cooldown_status(uuid) from authenticated;
grant execute on function public.get_my_cooldown_status(uuid) to service_role;

-- 9) profiles select 권한에 페널티 컬럼 추가
revoke all on table public.profiles from authenticated;

grant select (
  id,
  email,
  display_name,
  riot_id,
  discord_username,
  discord_id,
  created_at,
  updated_at,
  last_match_sync_at,
  last_seen_at,
  trust_score,
  review_count,
  penalty_count,
  cooldown_until
) on table public.profiles to authenticated;

grant update (display_name) on table public.profiles to authenticated;

grant insert (
  id,
  email,
  display_name
) on table public.profiles to authenticated;
