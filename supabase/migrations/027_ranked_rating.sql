-- Supabase SQL Editor에서 Run 하세요.
-- 026_security_reputation.sql 실행 후 적용
--
-- profiles.ranked_rating — Valorant 경쟁전 RR (Ranked Rating)
-- set_profile_tier RPC가 tier + RR을 함께 저장

alter table public.profiles
  add column if not exists ranked_rating integer
    check (ranked_rating is null or (ranked_rating >= 0 and ranked_rating <= 9999));

comment on column public.profiles.ranked_rating is
  'Valorant 경쟁전 RR (RankedRatingAfterUpdate). null이면 미동기화/언랭.';

-- tier 변경 시 RR도 같이 막거나 허용 (app.writing_tier)
create or replace function public.block_direct_connection_update()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.linking_riot', true) is distinct from 'true'
    and current_setting('app.writing_shard', true) is distinct from 'true' then
    if new.riot_id is distinct from old.riot_id
      or new.riot_puuid is distinct from old.riot_puuid
      or new.valorant_shard is distinct from old.valorant_shard then
      raise exception 'Riot account must be linked via server API';
    end if;
  end if;

  if current_setting('app.linking_discord', true) is distinct from 'true' then
    if new.discord_id is distinct from old.discord_id
      or new.discord_username is distinct from old.discord_username then
      raise exception 'Discord account must be linked via server API';
    end if;
  end if;

  if current_setting('app.writing_analysis', true) is distinct from 'true' then
    if new.last_analyzed_at is distinct from old.last_analyzed_at
      or new.playstyle_tags is distinct from old.playstyle_tags
      or new.aggression_score is distinct from old.aggression_score
      or new.role_preference is distinct from old.role_preference
      or new.analysis_source is distinct from old.analysis_source
      or new.synergy_notes is distinct from old.synergy_notes
      or new.trend_summary is distinct from old.trend_summary
      or new.situational_notes is distinct from old.situational_notes
      or new.anomaly_notes is distinct from old.anomaly_notes then
      raise exception 'Playstyle analysis must be saved via server API';
    end if;
  end if;

  if current_setting('app.writing_plan', true) is distinct from 'true' then
    if new.plan is distinct from old.plan then
      raise exception 'Plan must be changed via server API';
    end if;
  end if;

  if current_setting('app.writing_tier', true) is distinct from 'true' then
    if new.tier is distinct from old.tier
      or new.ranked_rating is distinct from old.ranked_rating then
      raise exception 'Tier must be updated via server API';
    end if;
  end if;

  if current_setting('app.writing_presence', true) is distinct from 'true' then
    if new.last_seen_at is distinct from old.last_seen_at then
      raise exception 'Presence must be updated via server API';
    end if;
  end if;

  if current_setting('app.writing_match_sync', true) is distinct from 'true' then
    if new.last_match_sync_at is distinct from old.last_match_sync_at then
      raise exception 'Match sync timestamp must be updated via server API';
    end if;
  end if;

  if current_setting('app.writing_reputation', true) is distinct from 'true' then
    if new.trust_score is distinct from old.trust_score
      or new.review_count is distinct from old.review_count
      or new.penalty_count is distinct from old.penalty_count
      or new.penalty_deduction is distinct from old.penalty_deduction
      or new.cooldown_until is distinct from old.cooldown_until then
      raise exception 'Reputation must be updated via server API';
    end if;
  end if;

  return new;
end;
$$;

-- set_profile_tier: RR 파라미터 추가 (시그니처 변경 → drop 후 생성)
drop function if exists public.set_profile_tier(uuid, integer);

create or replace function public.set_profile_tier(
  p_user_id uuid,
  p_tier integer,
  p_ranked_rating integer default null
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

  if p_tier is not null and (p_tier < 0 or p_tier > 26) then
    raise exception 'invalid tier';
  end if;

  if p_ranked_rating is not null
    and (p_ranked_rating < 0 or p_ranked_rating > 9999) then
    raise exception 'invalid ranked_rating';
  end if;

  perform set_config('app.writing_tier', 'true', true);

  update public.profiles
  set
    tier = p_tier,
    ranked_rating = p_ranked_rating,
    updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'profile_not_found';
  end if;
end;
$$;

revoke all on function public.set_profile_tier(uuid, integer, integer) from public;
revoke all on function public.set_profile_tier(uuid, integer, integer) from authenticated;
revoke all on function public.set_profile_tier(uuid, integer, integer) from anon;
grant execute on function public.set_profile_tier(uuid, integer, integer) to service_role;

-- 라이엇 연동 해제 시 RR도 제거
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

  perform set_config('app.linking_riot', 'true', true);
  perform set_config('app.writing_tier', 'true', true);

  update public.profiles
  set
    riot_id = null,
    riot_puuid = null,
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

-- 본인 프로필 조회에 ranked_rating 추가
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
  tier,
  ranked_rating
) on table public.profiles to authenticated;

grant update (display_name) on table public.profiles to authenticated;

grant insert (
  id,
  email,
  display_name
) on table public.profiles to authenticated;
