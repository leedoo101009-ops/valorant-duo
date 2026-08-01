-- Supabase SQL Editor에서 Run 하세요.
-- 회원가입 온보딩 2단계: duo_goal / riot_linked / onboarding_completed

-- 1) 컬럼 추가
alter table public.profiles
  add column if not exists duo_goal text
    check (duo_goal is null or duo_goal in ('rank_up', 'casual_duo', 'any'));

alter table public.profiles
  add column if not exists riot_linked boolean not null default false;

alter table public.profiles
  add column if not exists onboarding_completed boolean not null default false;

comment on column public.profiles.duo_goal is
  '온보딩 1단계: rank_up | casual_duo | any';
comment on column public.profiles.riot_linked is
  '라이엇 연동 여부 (표시/필터용). 실제 연동 키는 riot_id/riot_puuid';
comment on column public.profiles.onboarding_completed is
  '온보딩 완료(스킵 포함). false면 /onboarding 유도';

-- 2) 기존 유저: 온보딩 강제하지 않음 + riot_id 있으면면 riot_linked=true
-- (이후 신규 가입자는 default false → /onboarding 유도)
update public.profiles
set
  onboarding_completed = true,
  riot_linked = (riot_id is not null);

-- 3) 라이엇 연동 RPC — riot_linked 동기화
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
    riot_puuid = p_riot_puuid,
    riot_linked = true,
    updated_at = now()
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

-- 4) 라이엇 해제 RPC — riot_linked=false
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

  if exists (
    select 1 from public.duo_matches
    where status in ('active', 'in_game')
      and (user_a_id = p_user_id or user_b_id = p_user_id)
  ) then
    raise exception 'active_match_exists';
  end if;

  -- 027과 동일: shard/tier/RR도 같이 지움 (writing_tier 가드 필요)
  perform set_config('app.linking_riot', 'true', true);
  perform set_config('app.writing_tier', 'true', true);

  update public.profiles
  set
    riot_id = null,
    riot_puuid = null,
    riot_linked = false,
    valorant_shard = null,
    tier = null,
    ranked_rating = null,
    updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'profile_not_found';
  end if;

  perform set_config('app.match_queue_write', 'true', true);
  delete from public.match_queue_entries where user_id = p_user_id;
  perform set_config('app.match_queue_write', 'false', true);
end;
$$;

revoke all on function public.unlink_riot_account(uuid) from public;
revoke all on function public.unlink_riot_account(uuid) from authenticated;
revoke all on function public.unlink_riot_account(uuid) from anon;
grant execute on function public.unlink_riot_account(uuid) to service_role;

-- 5) 온보딩 저장 RPC (서버 전용) — duo_goal / 완료 / 스킵 시 riot_linked=false
create or replace function public.save_onboarding(
  p_user_id uuid,
  p_duo_goal text default null,
  p_complete boolean default false,
  p_riot_skipped boolean default false
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

  if p_duo_goal is not null
     and p_duo_goal not in ('rank_up', 'casual_duo', 'any') then
    raise exception 'invalid_duo_goal';
  end if;

  update public.profiles
  set
    duo_goal = coalesce(p_duo_goal, duo_goal),
    onboarding_completed = case
      when p_complete then true
      else onboarding_completed
    end,
    -- 스킵할 때만 false로 고정. 이미 연동된 사람은 true 유지.
    riot_linked = case
      when p_riot_skipped and riot_id is null then false
      when riot_id is not null then true
      else riot_linked
    end,
    updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'profile_not_found';
  end if;
end;
$$;

revoke all on function public.save_onboarding(uuid, text, boolean, boolean) from public;
revoke all on function public.save_onboarding(uuid, text, boolean, boolean) from authenticated;
revoke all on function public.save_onboarding(uuid, text, boolean, boolean) from anon;
grant execute on function public.save_onboarding(uuid, text, boolean, boolean) to service_role;

-- 6) authenticated select에 온보딩 컬럼 추가 (028 목록 + 신규)
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
  trend_summary,
  situational_notes,
  anomaly_notes,
  synergy_notes,
  match_prefs,
  tier,
  ranked_rating,
  duo_goal,
  riot_linked,
  onboarding_completed
) on table public.profiles to authenticated;

grant update (display_name) on table public.profiles to authenticated;

grant insert (
  id,
  email,
  display_name
) on table public.profiles to authenticated;
