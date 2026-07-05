-- Supabase SQL Editor에서 Run 하세요.
-- Phase 2-4: Discord 연동 — service_role RPC 전용 + 직접 수정 차단

-- 1) Discord 연동 RPC (Supabase Auth identity 검증 후 서버에서만 호출)
create or replace function public.link_discord_account(
  p_user_id uuid,
  p_discord_id text,
  p_discord_username text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception 'user_id required';
  end if;

  if p_discord_id is null or length(trim(p_discord_id)) = 0 then
    raise exception 'discord_id required';
  end if;

  perform set_config('app.linking_discord', 'true', true);

  update public.profiles
  set
    discord_id = p_discord_id,
    discord_username = coalesce(nullif(trim(p_discord_username), ''), discord_username)
  where id = p_user_id;

  if not found then
    raise exception 'Profile not found';
  end if;
end;
$$;

revoke all on function public.link_discord_account(uuid, text, text) from public;
revoke all on function public.link_discord_account(uuid, text, text) from authenticated;
revoke all on function public.link_discord_account(uuid, text, text) from anon;
grant execute on function public.link_discord_account(uuid, text, text) to service_role;

-- 2) Riot + Discord 컬럼 직접 UPDATE 차단 (기존 트리거 확장)
create or replace function public.block_direct_connection_update()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.linking_riot', true) is distinct from 'true' then
    if new.riot_id is distinct from old.riot_id
       or new.riot_puuid is distinct from old.riot_puuid then
      raise exception 'Riot account must be linked via server API';
    end if;
  end if;

  if current_setting('app.linking_discord', true) is distinct from 'true' then
    if new.discord_id is distinct from old.discord_id
       or new.discord_username is distinct from old.discord_username then
      raise exception 'Discord account must be linked via server API';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists block_direct_riot_update_trigger on public.profiles;
drop trigger if exists block_direct_connection_update_trigger on public.profiles;
create trigger block_direct_connection_update_trigger
  before update on public.profiles
  for each row
  execute function public.block_direct_connection_update();

-- 3) authenticated는 discord 컬럼 UPDATE 불가 (display_name만 — 005와 동일)
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
  last_match_sync_at
) on table public.profiles to authenticated;

grant update (display_name) on table public.profiles to authenticated;

grant insert (
  id,
  email,
  display_name
) on table public.profiles to authenticated;
