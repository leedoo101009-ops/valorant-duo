-- Supabase SQL Editor에서 Run 하세요.
-- Phase 4-2: 매칭 큐 (등록 / 취소 / 대기 인원)
-- 보안: RLS + service_role RPC + 직접 쓰기 차단 + 온라인 검증

create table if not exists public.match_queue_entries (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now()
);

create index if not exists match_queue_entries_joined_at_idx
  on public.match_queue_entries (joined_at asc);

comment on table public.match_queue_entries is '매칭 대기 큐 (Phase 4-3에서 pairing)';

alter table public.match_queue_entries enable row level security;

drop policy if exists "match_queue_select_own" on public.match_queue_entries;
create policy "match_queue_select_own"
  on public.match_queue_entries
  for select
  to authenticated
  using (auth.uid() = user_id);

revoke all on table public.match_queue_entries from public;
revoke all on table public.match_queue_entries from anon;
revoke all on table public.match_queue_entries from authenticated;
grant select on table public.match_queue_entries to authenticated;

-- 클라이언트 직접 insert/update/delete 차단 (service RPC만 허용)
create or replace function public.block_direct_queue_write()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.match_queue_write', true) is distinct from 'true' then
    raise exception 'Queue must be modified via server API';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists block_direct_queue_write_trigger on public.match_queue_entries;
create trigger block_direct_queue_write_trigger
  before insert or update or delete on public.match_queue_entries
  for each row
  execute function public.block_direct_queue_write();

-- 오프라인 유저 큐 정리 (heartbeat 5분 이상 없음)
create or replace function public.cleanup_stale_queue_entries()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.match_queue_write', 'true', true);

  delete from public.match_queue_entries m
  using public.profiles p
  where m.user_id = p.id
    and (
      p.last_seen_at is null
      or p.last_seen_at < now() - interval '5 minutes'
    );

  perform set_config('app.match_queue_write', 'false', true);
end;
$$;

revoke all on function public.cleanup_stale_queue_entries() from public;
grant execute on function public.cleanup_stale_queue_entries() to service_role;

-- 큐 등록 (service_role API만)
create or replace function public.join_match_queue(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

-- 큐 취소
create or replace function public.leave_match_queue(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception 'user_id required';
  end if;

  perform set_config('app.match_queue_write', 'true', true);

  delete from public.match_queue_entries
  where user_id = p_user_id;

  perform set_config('app.match_queue_write', 'false', true);
end;
$$;

revoke all on function public.leave_match_queue(uuid) from public;
revoke all on function public.leave_match_queue(uuid) from authenticated;
revoke all on function public.leave_match_queue(uuid) from anon;
grant execute on function public.leave_match_queue(uuid) to service_role;

-- 대기 인원 수 (공개 — count만, cleanup 없음 → RPC 남용 DoS 완화)
create or replace function public.count_queue_users()
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select count(*)::integer from public.match_queue_entries;
$$;

revoke all on function public.count_queue_users() from public;
grant execute on function public.count_queue_users() to anon;
grant execute on function public.count_queue_users() to authenticated;
