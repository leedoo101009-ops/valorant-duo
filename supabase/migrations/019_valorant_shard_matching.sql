-- Supabase SQL Editor에서 Run 하세요.
-- Phase 4-12: Valorant active-shard 기반 서버별 매칭
-- 018_no_voice_flow.sql 실행 후 적용

-- 1) 유저가 실제로 플레이하는 Valorant 서버(shard) 저장
alter table public.profiles
  add column if not exists valorant_shard text;

comment on column public.profiles.valorant_shard is
  'Valorant active shard (예: kr, ap, na, eu). 같은 shard끼리만 매칭하는 데 사용';

create index if not exists profiles_valorant_shard_idx
  on public.profiles (valorant_shard)
  where valorant_shard is not null;

-- 2) 큐 입장 시 shard가 저장된 Riot 연동 계정만 허용
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
    where id = p_user_id and valorant_shard is not null
  ) then
    raise exception 'valorant_shard_required';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_user_id
      and last_seen_at > now() - interval '90 seconds'
  ) then
    raise exception 'offline_required';
  end if;

  if exists (
    select 1 from public.duo_matches
    where status in ('active', 'in_game')
      and (user_a_id = p_user_id or user_b_id = p_user_id)
  ) then
    raise exception 'active_match_exists';
  end if;

  -- 쿨다운 검증
  select cooldown_until into v_cooldown_until
  from public.profiles
  where id = p_user_id;

  if v_cooldown_until is not null and v_cooldown_until > now() then
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

-- 3) 같은 Valorant shard끼리만 매칭
create or replace function public.process_match_queue()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_a uuid;
  v_user_b uuid;
  v_match_id uuid;
  v_shard text;
begin
  perform public.cleanup_stale_queue_entries();

  -- 같은 shard 후보가 실제로 있는 가장 오래된 유저를 고릅니다.
  -- 이렇게 해야 kr 유저 혼자 기다리는 상황에서 ap 유저들 매칭이 막히지 않습니다.
  select q.user_id, p.valorant_shard
    into v_user_a, v_shard
  from public.match_queue_entries q
  join public.profiles p on p.id = q.user_id
  where p.last_seen_at > now() - interval '90 seconds'
    and p.valorant_shard is not null
    and not exists (
      select 1 from public.duo_matches d
      where d.status in ('active', 'in_game')
        and (d.user_a_id = q.user_id or d.user_b_id = q.user_id)
    )
    and exists (
      select 1
      from public.match_queue_entries q2
      join public.profiles p2 on p2.id = q2.user_id
      where q2.user_id <> q.user_id
        and p2.valorant_shard = p.valorant_shard
        and p2.last_seen_at > now() - interval '90 seconds'
        and not exists (
          select 1 from public.duo_matches d2
          where d2.status in ('active', 'in_game')
            and (d2.user_a_id = q2.user_id or d2.user_b_id = q2.user_id)
        )
    )
  order by q.joined_at asc
  limit 1
  for update of q skip locked;

  if v_user_a is null then
    return null;
  end if;

  select q.user_id into v_user_b
  from public.match_queue_entries q
  join public.profiles p on p.id = q.user_id
  where q.user_id <> v_user_a
    and p.valorant_shard = v_shard
    and p.last_seen_at > now() - interval '90 seconds'
    and not exists (
      select 1 from public.duo_matches d
      where d.status in ('active', 'in_game')
        and (d.user_a_id = q.user_id or d.user_b_id = q.user_id)
    )
  order by q.joined_at asc
  limit 1
  for update of q skip locked;

  if v_user_b is null then
    return null;
  end if;

  insert into public.duo_matches (user_a_id, user_b_id, status)
  values (v_user_a, v_user_b, 'active')
  returning id into v_match_id;

  perform set_config('app.match_queue_write', 'true', true);

  delete from public.match_queue_entries
  where user_id in (v_user_a, v_user_b);

  perform set_config('app.match_queue_write', 'false', true);

  return v_match_id;
end;
$$;

revoke all on function public.process_match_queue() from public;
revoke all on function public.process_match_queue() from authenticated;
revoke all on function public.process_match_queue() from anon;
grant execute on function public.process_match_queue() to service_role;

-- 4) Riot 연동 해제 시 shard도 같이 제거
create or replace function public.unlink_riot_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception 'user_id required';
  end if;

  -- 매칭 중에는 해제 불가 (데이터 무결성)
  if exists (
    select 1 from public.duo_matches
    where status in ('active', 'in_game')
      and (user_a_id = p_user_id or user_b_id = p_user_id)
  ) then
    raise exception 'active_match_exists';
  end if;

  perform set_config('app.linking_riot', 'true', true);

  update public.profiles
  set
    riot_id = null,
    riot_puuid = null,
    valorant_shard = null,
    updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'profile_not_found';
  end if;

  -- 큐에 있으면 자동 퇴장 (Riot 계정 없이는 큐 유지 불가)
  perform set_config('app.match_queue_write', 'true', true);
  delete from public.match_queue_entries where user_id = p_user_id;
  perform set_config('app.match_queue_write', 'false', true);
end;
$$;

revoke all on function public.unlink_riot_account(uuid) from public;
revoke all on function public.unlink_riot_account(uuid) from authenticated;
grant execute on function public.unlink_riot_account(uuid) to service_role;

-- 5) 본인 프로필 조회 권한에 valorant_shard 추가
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
  cooldown_until
) on table public.profiles to authenticated;

grant update (display_name) on table public.profiles to authenticated;

grant insert (
  id,
  email,
  display_name
) on table public.profiles to authenticated;
