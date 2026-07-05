-- Supabase SQL Editor에서 Run 하세요.
-- 003 실행 후 적용. 보안 패치: RPC 서버 전용 + riot_puuid 컬럼 차단

-- 1) RPC: authenticated 직접 호출 불가 → service_role(API Route)만 호출
drop function if exists public.link_riot_account(text, text);

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

-- 2) riot_puuid: 클라이언트(authenticated)에서 읽기/쓰기 불가
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

-- 3) 트리거 (003 미실행 시 대비)
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
