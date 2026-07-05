-- Supabase SQL Editor에서 Run 하세요.
-- Phase 2-2: Riot 계정은 서버 API(RPC)로만 연동되게 보호
-- ⚠️ 보안 강화는 004_security_hardening.sql 도 함께 실행하세요.

-- 1) Riot 연동 전용 함수 (004에서 service_role 전용으로 교체됨)
create or replace function public.link_riot_account(
  p_user_id uuid,
  p_riot_id text,
  p_riot_puuid text
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

  perform set_config('app.linking_riot', 'true', true);

  update public.profiles
  set
    riot_id = p_riot_id,
    riot_puuid = p_riot_puuid
  where id = p_user_id;

  if not found then
    raise exception 'Profile not found';
  end if;
end;
$$;

revoke all on function public.link_riot_account(uuid, text, text) from public;
revoke all on function public.link_riot_account(uuid, text, text) from authenticated;
revoke all on function public.link_riot_account(uuid, text, text) from anon;
grant execute on function public.link_riot_account(uuid, text, text) to service_role;

-- 2) 클라이언트가 riot 컬럼을 직접 수정하는 것 차단
create or replace function public.block_direct_riot_update()
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

  return new;
end;
$$;

drop trigger if exists block_direct_riot_update_trigger on public.profiles;
create trigger block_direct_riot_update_trigger
  before update on public.profiles
  for each row
  execute function public.block_direct_riot_update();

-- 3) riot_puuid 클라이언트 읽기/쓰기 차단
revoke all on table public.profiles from authenticated;

grant select (
  id,
  email,
  display_name,
  riot_id,
  discord_username,
  discord_id,
  created_at,
  updated_at
) on table public.profiles to authenticated;

grant update (display_name) on table public.profiles to authenticated;

grant insert (
  id,
  email,
  display_name
) on table public.profiles to authenticated;
