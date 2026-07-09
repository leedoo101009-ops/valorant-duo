-- Supabase SQL Editor에서 Run 하세요.
-- Phase 2-5: Riot / Discord 연동 해제
-- 006_protect_discord_link.sql 실행 후 적용

-- 라이엇 연동 해제 (서버 API 전용)
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
    updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'profile_not_found';
  end if;

  -- 큐에 있으면 자동 퇴장 (riot_id 없으면 큐 유지 불가)
  perform set_config('app.match_queue_write', 'true', true);
  delete from public.match_queue_entries where user_id = p_user_id;
  perform set_config('app.match_queue_write', 'false', true);
end;
$$;

revoke all on function public.unlink_riot_account(uuid) from public;
revoke all on function public.unlink_riot_account(uuid) from authenticated;
grant execute on function public.unlink_riot_account(uuid) to service_role;

-- Discord 연동 해제 (프로필 필드만 — Auth identity는 API에서 별도 처리)
create or replace function public.unlink_discord_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception 'user_id required';
  end if;

  if exists (
    select 1 from public.duo_matches
    where status in ('active', 'in_game')
      and (user_a_id = p_user_id or user_b_id = p_user_id)
  ) then
    raise exception 'active_match_exists';
  end if;

  perform set_config('app.linking_discord', 'true', true);

  update public.profiles
  set
    discord_id = null,
    discord_username = null,
    updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'profile_not_found';
  end if;
end;
$$;

revoke all on function public.unlink_discord_account(uuid) from public;
revoke all on function public.unlink_discord_account(uuid) from authenticated;
grant execute on function public.unlink_discord_account(uuid) to service_role;
