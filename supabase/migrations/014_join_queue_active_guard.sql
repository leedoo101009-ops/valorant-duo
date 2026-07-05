-- Supabase SQL Editor에서 Run 하세요.
-- 보안: 활성 매칭 중에는 큐 재등록 차단
-- 013_match_setup_phase.sql 실행 후 적용

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

  if exists (
    select 1 from public.duo_matches
    where status in ('active', 'in_game')
      and (user_a_id = p_user_id or user_b_id = p_user_id)
  ) then
    raise exception 'active_match_exists';
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
