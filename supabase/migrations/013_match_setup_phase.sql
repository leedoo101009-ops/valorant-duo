-- Supabase SQL Editor에서 Run 하세요.
-- Phase 4-7: 파티 구성(완료/취소) + 게임 중 화면
-- 012_match_partner_offline.sql 실행 후 적용

alter table public.duo_matches
  add column if not exists match_phase text not null default 'connecting',
  add column if not exists setup_started_at timestamptz,
  add column if not exists user_a_setup_ready boolean not null default false,
  add column if not exists user_b_setup_ready boolean not null default false,
  add column if not exists in_game_at timestamptz,
  add column if not exists cancelled_by_user_id uuid references public.profiles (id) on delete set null;

alter table public.duo_matches
  drop constraint if exists duo_matches_match_phase_check;

alter table public.duo_matches
  add constraint duo_matches_match_phase_check
  check (match_phase in ('connecting', 'setup', 'in_game'));

alter table public.duo_matches
  drop constraint if exists duo_matches_status_check;

alter table public.duo_matches
  add constraint duo_matches_status_check
  check (status in ('active', 'in_game', 'completed', 'cancelled'));

comment on column public.duo_matches.match_phase is 'connecting(보이스) → setup(파티구성) → in_game';
comment on column public.duo_matches.setup_started_at is '양쪽 보이스 선택 완료 시각 — 4분 타임아웃 기준';
comment on column public.duo_matches.cancelled_by_user_id is 'setup_cancelled 시 취소한 유저';

drop index if exists public.duo_matches_one_active_user_a_idx;
drop index if exists public.duo_matches_one_active_user_b_idx;

create unique index duo_matches_one_active_user_a_idx
  on public.duo_matches (user_a_id)
  where status in ('active', 'in_game');

create unique index duo_matches_one_active_user_b_idx
  on public.duo_matches (user_b_id)
  where status in ('active', 'in_game');

-- 보이스 선택 시 setup 단계 진입
create or replace function public.update_match_connection(
  p_user_id uuid,
  p_match_id uuid,
  p_voice_preference text default null,
  p_party_code text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_user_a boolean;
  v_party_code_by uuid;
  v_clean_party_code text;
  v_user_a_voice text;
  v_user_b_voice text;
begin
  if p_user_id is null or p_match_id is null then
    raise exception 'user_id and match_id required';
  end if;

  select (user_a_id = p_user_id), party_code_by
  into v_is_user_a, v_party_code_by
  from public.duo_matches
  where id = p_match_id
    and status = 'active'
    and match_phase in ('connecting', 'setup')
    and (user_a_id = p_user_id or user_b_id = p_user_id);

  if v_is_user_a is null then
    raise exception 'match_not_found';
  end if;

  if p_voice_preference is not null
     and p_voice_preference not in ('valorant', 'discord', 'none') then
    raise exception 'invalid_voice_preference';
  end if;

  if p_party_code is not null then
    v_clean_party_code := upper(trim(p_party_code));

    if v_clean_party_code !~ '^[A-Z0-9_-]{4,32}$' then
      raise exception 'invalid_party_code';
    end if;

    if v_party_code_by is not null and v_party_code_by <> p_user_id then
      raise exception 'party_code_locked';
    end if;
  end if;

  update public.duo_matches
  set
    user_a_voice_preference = case
      when p_voice_preference is not null and v_is_user_a then p_voice_preference
      else user_a_voice_preference
    end,
    user_b_voice_preference = case
      when p_voice_preference is not null and not v_is_user_a then p_voice_preference
      else user_b_voice_preference
    end,
    party_code = coalesce(v_clean_party_code, party_code),
    party_code_by = case
      when v_clean_party_code is not null then p_user_id
      else party_code_by
    end
  where id = p_match_id
    and status = 'active';

  select user_a_voice_preference, user_b_voice_preference
  into v_user_a_voice, v_user_b_voice
  from public.duo_matches
  where id = p_match_id;

  if v_user_a_voice is not null and v_user_b_voice is not null then
    update public.duo_matches
    set
      match_phase = 'setup',
      setup_started_at = coalesce(setup_started_at, now())
    where id = p_match_id
      and status = 'active'
      and match_phase = 'connecting';
  end if;
end;
$$;

-- 파티 구성 완료 버튼
create or replace function public.mark_setup_ready(p_user_id uuid, p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_user_a boolean;
  v_user_a_ready boolean;
  v_user_b_ready boolean;
begin
  if p_user_id is null or p_match_id is null then
    raise exception 'user_id and match_id required';
  end if;

  select (user_a_id = p_user_id)
  into v_is_user_a
  from public.duo_matches
  where id = p_match_id
    and status = 'active'
    and match_phase = 'setup'
    and user_a_voice_preference is not null
    and user_b_voice_preference is not null
    and (user_a_id = p_user_id or user_b_id = p_user_id);

  if v_is_user_a is null then
    raise exception 'match_not_found';
  end if;

  update public.duo_matches
  set
    user_a_setup_ready = case when v_is_user_a then true else user_a_setup_ready end,
    user_b_setup_ready = case when not v_is_user_a then true else user_b_setup_ready end
  where id = p_match_id;

  select user_a_setup_ready, user_b_setup_ready
  into v_user_a_ready, v_user_b_ready
  from public.duo_matches
  where id = p_match_id;

  if v_user_a_ready and v_user_b_ready then
    update public.duo_matches
    set
      status = 'in_game',
      match_phase = 'in_game',
      in_game_at = now()
    where id = p_match_id;
  end if;
end;
$$;

revoke all on function public.mark_setup_ready(uuid, uuid) from public;
revoke all on function public.mark_setup_ready(uuid, uuid) from authenticated;
revoke all on function public.mark_setup_ready(uuid, uuid) from anon;
grant execute on function public.mark_setup_ready(uuid, uuid) to service_role;

-- 파티 구성 취소 버튼
create or replace function public.cancel_duo_match_setup(p_user_id uuid, p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
    and (user_a_id = p_user_id or user_b_id = p_user_id);

  if not found then
    raise exception 'match_not_found';
  end if;
end;
$$;

revoke all on function public.cancel_duo_match_setup(uuid, uuid) from public;
revoke all on function public.cancel_duo_match_setup(uuid, uuid) from authenticated;
revoke all on function public.cancel_duo_match_setup(uuid, uuid) from anon;
grant execute on function public.cancel_duo_match_setup(uuid, uuid) to service_role;

-- 파티 구성 4분 타임아웃
create or replace function public.expire_setup_duo_matches(p_timeout_seconds integer default 240)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_timeout integer;
  v_count integer;
begin
  safe_timeout := greatest(coalesce(p_timeout_seconds, 240), 60);
  safe_timeout := least(safe_timeout, 900);

  update public.duo_matches
  set
    status = 'cancelled',
    cancel_reason = 'setup_timeout'
  where status = 'active'
    and match_phase = 'setup'
    and setup_started_at is not null
    and setup_started_at < now() - (safe_timeout || ' seconds')::interval
    and not (user_a_setup_ready and user_b_setup_ready);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.expire_setup_duo_matches(integer) from public;
revoke all on function public.expire_setup_duo_matches(integer) from authenticated;
revoke all on function public.expire_setup_duo_matches(integer) from anon;
grant execute on function public.expire_setup_duo_matches(integer) to service_role;

-- 보이스 미선택 타임아웃 — connecting 단계만
create or replace function public.expire_inactive_duo_matches(p_timeout_seconds integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_timeout integer;
  v_count integer;
begin
  safe_timeout := greatest(coalesce(p_timeout_seconds, 90), 30);
  safe_timeout := least(safe_timeout, 600);

  update public.duo_matches
  set
    status = 'cancelled',
    cancel_reason = 'voice_response_timeout',
    updated_at = now()
  where status = 'active'
    and match_phase = 'connecting'
    and created_at < now() - (safe_timeout || ' seconds')::interval
    and (
      user_a_voice_preference is null
      or user_b_voice_preference is null
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 이탈 시 in_game 매칭도 취소
create or replace function public.cancel_duo_match_for_offline_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    return;
  end if;

  update public.duo_matches
  set
    status = 'cancelled',
    cancel_reason = 'partner_offline',
    offline_user_id = p_user_id
  where status in ('active', 'in_game')
    and (user_a_id = p_user_id or user_b_id = p_user_id);
end;
$$;

-- 오프라인 만료 — in_game 포함
create or replace function public.expire_offline_duo_matches(p_threshold_seconds integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_threshold integer;
  v_count integer;
  v_total integer := 0;
begin
  safe_threshold := greatest(coalesce(p_threshold_seconds, 90), 30);
  safe_threshold := least(safe_threshold, 600);

  update public.duo_matches m
  set
    status = 'cancelled',
    cancel_reason = 'partner_offline',
    offline_user_id = m.user_a_id
  from public.profiles pa, public.profiles pb
  where m.status in ('active', 'in_game')
    and pa.id = m.user_a_id
    and pb.id = m.user_b_id
    and (
      pa.last_seen_at is null
      or pa.last_seen_at < now() - (safe_threshold || ' seconds')::interval
    )
    and pb.last_seen_at > now() - (safe_threshold || ' seconds')::interval;

  get diagnostics v_count = row_count;
  v_total := v_total + v_count;

  update public.duo_matches m
  set
    status = 'cancelled',
    cancel_reason = 'partner_offline',
    offline_user_id = m.user_b_id
  from public.profiles pa, public.profiles pb
  where m.status in ('active', 'in_game')
    and pa.id = m.user_a_id
    and pb.id = m.user_b_id
    and pa.last_seen_at > now() - (safe_threshold || ' seconds')::interval
    and (
      pb.last_seen_at is null
      or pb.last_seen_at < now() - (safe_threshold || ' seconds')::interval
    );

  get diagnostics v_count = row_count;
  v_total := v_total + v_count;

  update public.duo_matches m
  set
    status = 'cancelled',
    cancel_reason = 'partner_offline',
    offline_user_id = null
  from public.profiles pa, public.profiles pb
  where m.status in ('active', 'in_game')
    and pa.id = m.user_a_id
    and pb.id = m.user_b_id
    and (
      pa.last_seen_at is null
      or pa.last_seen_at < now() - (safe_threshold || ' seconds')::interval
    )
    and (
      pb.last_seen_at is null
      or pb.last_seen_at < now() - (safe_threshold || ' seconds')::interval
    );

  get diagnostics v_count = row_count;
  v_total := v_total + v_count;

  return v_total;
end;
$$;

-- 게임 중 세션 종료
create or replace function public.dismiss_duo_match(p_user_id uuid, p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null or p_match_id is null then
    raise exception 'user_id and match_id required';
  end if;

  update public.duo_matches
  set
    status = 'completed',
    cancel_reason = 'manual'
  where id = p_match_id
    and status in ('active', 'in_game')
    and (user_a_id = p_user_id or user_b_id = p_user_id);

  if not found then
    raise exception 'match_not_found';
  end if;
end;
$$;
