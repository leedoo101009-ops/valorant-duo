-- Supabase SQL Editor에서 Run 하세요.
-- Phase 5-3: 티어 컬럼 + 궁합 기반 스마트 매칭 (A안: 계산은 TS, DB는 후보 조회 + 매치 생성)
-- 021_synergy_notes.sql 실행 후 적용

-- ─────────────────────────────────────────────
-- 1) profiles.tier — 랭크 단계 인덱스 (Iron1=0 ... Radiant=26). null이면 미설정.
alter table public.profiles
  add column if not exists tier smallint
    check (tier is null or (tier >= 0 and tier <= 26));

comment on column public.profiles.tier is
  'Valorant 랭크 단계 인덱스 0~26 (Iron1=0 ... Radiant=26). null이면 티어 매칭 조건 건너뜀.';

-- ─────────────────────────────────────────────
-- 2) 매칭 후보 조회 RPC (service_role 전용)
--    같은 shard + 활성(90초 내) + 진행 중 매치 없음. 본인 포함해서 반환합니다.
--    (본인 행의 joined_at으로 대기 시간을, 본인 프로필로 궁합 계산 기준을 만듭니다)
create or replace function public.get_match_queue_candidates(p_shard text)
returns table (
  user_id uuid,
  joined_at timestamptz,
  tier smallint,
  aggression_score double precision,
  role_preference text,
  seconds_since_last_seen double precision
)
language sql
security definer
set search_path = public
stable
as $$
  select
    q.user_id,
    q.joined_at,
    p.tier,
    p.aggression_score,
    p.role_preference,
    extract(epoch from (now() - p.last_seen_at)) as seconds_since_last_seen
  from public.match_queue_entries q
  join public.profiles p on p.id = q.user_id
  where p.valorant_shard = p_shard
    and p.last_seen_at > now() - interval '90 seconds'
    and not exists (
      select 1 from public.duo_matches d
      where d.status in ('active', 'in_game')
        and (d.user_a_id = q.user_id or d.user_b_id = q.user_id)
    )
  order by q.joined_at asc;
$$;

revoke all on function public.get_match_queue_candidates(text) from public;
revoke all on function public.get_match_queue_candidates(text) from authenticated;
revoke all on function public.get_match_queue_candidates(text) from anon;
grant execute on function public.get_match_queue_candidates(text) to service_role;

-- ─────────────────────────────────────────────
-- 3) 특정 두 유저로 매치 생성 RPC (service_role 전용)
--    TS의 findBestMatch가 "누구와 누구"를 고르면, 이 함수가 원자적으로 검증 후 생성합니다.
--    동시성: 큐 엔트리를 for update skip locked로 잠가서 같은 유저를 두 매치에 못 넣게 막습니다.
--    가드 실패 시 예외 대신 null 반환 → best-effort 호출부가 조용히 넘어감.
create or replace function public.create_duo_match(p_user_a uuid, p_user_b uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match_id uuid;
  v_locked integer;
  v_shard_a text;
  v_shard_b text;
begin
  if p_user_a is null or p_user_b is null or p_user_a = p_user_b then
    raise exception 'invalid_users';
  end if;

  -- 두 유저의 큐 엔트리를 잠급니다. 다른 트랜잭션이 이미 잠갔으면(skip locked)
  -- 잠긴 행 수가 2 미만 → 이미 다른 매칭이 진행 중이므로 포기(null).
  select count(*) into v_locked
  from (
    select user_id
    from public.match_queue_entries
    where user_id in (p_user_a, p_user_b)
    for update skip locked
  ) locked_rows;

  if v_locked < 2 then
    return null;
  end if;

  -- 둘 중 하나라도 이미 진행 중 매치가 있으면 포기
  if exists (
    select 1 from public.duo_matches
    where status in ('active', 'in_game')
      and (
        user_a_id in (p_user_a, p_user_b)
        or user_b_id in (p_user_a, p_user_b)
      )
  ) then
    return null;
  end if;

  -- 활성(최근 접속) + shard 재확인 (조회 시점과 생성 시점 사이에 바뀌었을 수 있음)
  select valorant_shard into v_shard_a
  from public.profiles
  where id = p_user_a and last_seen_at > now() - interval '90 seconds';

  select valorant_shard into v_shard_b
  from public.profiles
  where id = p_user_b and last_seen_at > now() - interval '90 seconds';

  if v_shard_a is null or v_shard_b is null or v_shard_a <> v_shard_b then
    return null;
  end if;

  insert into public.duo_matches (user_a_id, user_b_id, status)
  values (p_user_a, p_user_b, 'active')
  returning id into v_match_id;

  perform set_config('app.match_queue_write', 'true', true);

  delete from public.match_queue_entries
  where user_id in (p_user_a, p_user_b);

  perform set_config('app.match_queue_write', 'false', true);

  return v_match_id;
end;
$$;

revoke all on function public.create_duo_match(uuid, uuid) from public;
revoke all on function public.create_duo_match(uuid, uuid) from authenticated;
revoke all on function public.create_duo_match(uuid, uuid) from anon;
grant execute on function public.create_duo_match(uuid, uuid) to service_role;

-- ─────────────────────────────────────────────
-- 4) 본인 프로필 select 권한에 tier 추가
revoke all on table public.profiles from authenticated;

grant select (
  id,
  email,
  display_name,
  riot_id,
  valorant_shard,
  discord_username,
  discord_id,
  created_at,
  updated_at,
  last_match_sync_at,
  last_seen_at,
  trust_score,
  review_count,
  penalty_count,
  cooldown_until,
  plan,
  last_analyzed_at,
  playstyle_tags,
  aggression_score,
  role_preference,
  analysis_source,
  synergy_notes,
  tier
) on table public.profiles to authenticated;

grant update (display_name) on table public.profiles to authenticated;

grant insert (
  id,
  email,
  display_name
) on table public.profiles to authenticated;
