-- Supabase SQL Editor에서 Run 하세요.
-- Phase 4-3: 매칭 알고리즘 (FIFO 2인 pairing) + 활성 매치 관리
-- 008_match_queue.sql 실행 후 적용

create table if not exists public.duo_matches (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid not null references public.profiles (id) on delete cascade,
  user_b_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint duo_matches_distinct_users check (user_a_id <> user_b_id)
);

create index if not exists duo_matches_created_at_idx
  on public.duo_matches (created_at desc);

create unique index if not exists duo_matches_one_active_user_a_idx
  on public.duo_matches (user_a_id)
  where status = 'active';

create unique index if not exists duo_matches_one_active_user_b_idx
  on public.duo_matches (user_b_id)
  where status = 'active';

comment on table public.duo_matches is '듀오 매칭 결과 (MVP: FIFO 2인)';

drop trigger if exists duo_matches_updated_at on public.duo_matches;
create trigger duo_matches_updated_at
  before update on public.duo_matches
  for each row
  execute function public.set_updated_at();

alter table public.duo_matches enable row level security;

drop policy if exists "duo_matches_select_participant" on public.duo_matches;
create policy "duo_matches_select_participant"
  on public.duo_matches
  for select
  to authenticated
  using (auth.uid() = user_a_id or auth.uid() = user_b_id);

revoke all on table public.duo_matches from public;
revoke all on table public.duo_matches from anon;
revoke all on table public.duo_matches from authenticated;
grant select on table public.duo_matches to authenticated;

-- 큐에서 2명 FIFO pairing (service_role만)
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
begin
  perform public.cleanup_stale_queue_entries();

  select q.user_id into v_user_a
  from public.match_queue_entries q
  join public.profiles p on p.id = q.user_id
  where p.last_seen_at > now() - interval '90 seconds'
    and not exists (
      select 1 from public.duo_matches d
      where d.status = 'active'
        and (d.user_a_id = q.user_id or d.user_b_id = q.user_id)
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
    and p.last_seen_at > now() - interval '90 seconds'
    and not exists (
      select 1 from public.duo_matches d
      where d.status = 'active'
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

-- 매치 종료 (본인만)
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
  set status = 'completed'
  where id = p_match_id
    and status = 'active'
    and (user_a_id = p_user_id or user_b_id = p_user_id);

  if not found then
    raise exception 'match_not_found';
  end if;
end;
$$;

revoke all on function public.dismiss_duo_match(uuid, uuid) from public;
revoke all on function public.dismiss_duo_match(uuid, uuid) from authenticated;
revoke all on function public.dismiss_duo_match(uuid, uuid) from anon;
grant execute on function public.dismiss_duo_match(uuid, uuid) to service_role;
