-- Supabase SQL Editor에서 Run 하세요.
-- Phase 4-1: 온라인 상태 (heartbeat + 접속자 수)

alter table public.profiles
  add column if not exists last_seen_at timestamptz;

comment on column public.profiles.last_seen_at is '마지막 heartbeat 시각 (온라인 판정용)';

create index if not exists profiles_last_seen_at_idx
  on public.profiles (last_seen_at desc)
  where last_seen_at is not null;

-- 1) heartbeat — API Route(service_role)만 호출
create or replace function public.touch_presence(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception 'user_id required';
  end if;

  update public.profiles
  set last_seen_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'Profile not found';
  end if;
end;
$$;

revoke all on function public.touch_presence(uuid) from public;
revoke all on function public.touch_presence(uuid) from authenticated;
revoke all on function public.touch_presence(uuid) from anon;
grant execute on function public.touch_presence(uuid) to service_role;

-- 2) 공개 접속자 수 — 개인정보 없이 count만 반환
create or replace function public.count_online_users(p_threshold_seconds integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_threshold integer;
begin
  safe_threshold := greatest(coalesce(p_threshold_seconds, 90), 30);
  safe_threshold := least(safe_threshold, 600);

  return (
    select count(*)::integer
    from public.profiles
    where last_seen_at > now() - (safe_threshold || ' seconds')::interval
  );
end;
$$;

revoke all on function public.count_online_users(integer) from public;
grant execute on function public.count_online_users(integer) to anon;
grant execute on function public.count_online_users(integer) to authenticated;

-- 3) profiles select 권한 유지 (last_seen_at은 본인만 — RLS row 단위)
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
  last_seen_at
) on table public.profiles to authenticated;

grant update (display_name) on table public.profiles to authenticated;

grant insert (
  id,
  email,
  display_name
) on table public.profiles to authenticated;
