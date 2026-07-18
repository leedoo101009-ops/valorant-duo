-- Supabase SQL Editor에서 Run 하세요.
-- 027_ranked_rating.sql 실행 후 적용
--
-- premium 매칭 힌트(match_prefs) — Claude/규칙 fallback이 저장하는 구조화 JSON
-- free는 null. 매칭 시 premium 쪽 prefs로 후보 순위만 더 세밀하게 매김 (대기 시간 강제↑ 아님)

-- 1) 컬럼
alter table public.profiles
  add column if not exists match_prefs jsonb;

comment on column public.profiles.match_prefs is
  'premium 매칭 힌트 JSON: preferred_roles/preferred_tags/avoid_tags/preferred_aggression. free는 null.';

-- 2) 직접 UPDATE 차단 — match_prefs도 분석 RPC로만
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
      or new.anomaly_notes is distinct from old.anomaly_notes
      or new.match_prefs is distinct from old.match_prefs then
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

-- 3) save_playstyle_analysis — match_prefs 파라미터 추가
drop function if exists public.save_playstyle_analysis(
  uuid, jsonb, double precision, text, text, text, text, text, text
);

create or replace function public.save_playstyle_analysis(
  p_user_id uuid,
  p_playstyle_tags jsonb,
  p_aggression_score double precision,
  p_role_preference text,
  p_analysis_source text,
  p_trend_summary text default null,
  p_situational_notes text default null,
  p_anomaly_notes text default null,
  p_synergy_notes text default null,
  p_match_prefs jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tag jsonb;
  v_tag_text text;
  v_tag_count integer;
begin
  if p_user_id is null then
    raise exception 'user_id required';
  end if;

  if p_playstyle_tags is null or jsonb_typeof(p_playstyle_tags) <> 'array' then
    raise exception 'playstyle_tags must be a json array';
  end if;

  v_tag_count := jsonb_array_length(p_playstyle_tags);
  if v_tag_count < 1 or v_tag_count > 4 then
    raise exception 'playstyle_tags must have 1 to 4 items';
  end if;

  for v_tag in select value from jsonb_array_elements(p_playstyle_tags)
  loop
    if jsonb_typeof(v_tag) <> 'string' then
      raise exception 'playstyle_tags must be strings';
    end if;
    v_tag_text := v_tag #>> '{}';
    if length(v_tag_text) = 0 or length(v_tag_text) > 32 then
      raise exception 'playstyle_tags item length invalid';
    end if;
  end loop;

  if p_aggression_score is null
    or p_aggression_score < 0
    or p_aggression_score > 1 then
    raise exception 'aggression_score must be between 0 and 1';
  end if;

  if p_role_preference is not null
    and nullif(trim(p_role_preference), '') is not null
    and trim(p_role_preference) not in (
      'duelist', 'initiator', 'controller', 'sentinel', 'flex'
    ) then
    raise exception 'invalid role_preference';
  end if;

  if p_analysis_source is null
    or p_analysis_source not in ('gemini', 'rule_based', 'claude') then
    raise exception 'invalid analysis_source';
  end if;

  if length(coalesce(p_trend_summary, '')) > 500
    or length(coalesce(p_situational_notes, '')) > 500
    or length(coalesce(p_anomaly_notes, '')) > 500
    or length(coalesce(p_synergy_notes, '')) > 500 then
    raise exception 'note field too long';
  end if;

  -- match_prefs: null 허용. object일 때만 저장 (배열·문자열 거부)
  if p_match_prefs is not null and jsonb_typeof(p_match_prefs) <> 'object' then
    raise exception 'match_prefs must be a json object or null';
  end if;

  if p_match_prefs is not null and length(p_match_prefs::text) > 2000 then
    raise exception 'match_prefs too large';
  end if;

  perform set_config('app.writing_analysis', 'true', true);

  update public.profiles
  set
    playstyle_tags = p_playstyle_tags,
    aggression_score = p_aggression_score,
    role_preference = nullif(trim(coalesce(p_role_preference, '')), ''),
    analysis_source = p_analysis_source,
    trend_summary = nullif(trim(coalesce(p_trend_summary, '')), ''),
    situational_notes = nullif(trim(coalesce(p_situational_notes, '')), ''),
    anomaly_notes = nullif(trim(coalesce(p_anomaly_notes, '')), ''),
    synergy_notes = nullif(trim(coalesce(p_synergy_notes, '')), ''),
    match_prefs = p_match_prefs,
    last_analyzed_at = now(),
    updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'profile_not_found';
  end if;
end;
$$;

revoke all on function public.save_playstyle_analysis(
  uuid, jsonb, double precision, text, text, text, text, text, text, jsonb
) from public;
revoke all on function public.save_playstyle_analysis(
  uuid, jsonb, double precision, text, text, text, text, text, text, jsonb
) from authenticated;
revoke all on function public.save_playstyle_analysis(
  uuid, jsonb, double precision, text, text, text, text, text, text, jsonb
) from anon;
grant execute on function public.save_playstyle_analysis(
  uuid, jsonb, double precision, text, text, text, text, text, text, jsonb
) to service_role;

-- 4) 매칭 후보 RPC — plan / tags / match_prefs 포함 (반환 타입 변경 → drop 후 생성)
drop function if exists public.get_match_queue_candidates(text);

create or replace function public.get_match_queue_candidates(p_shard text)
returns table (
  user_id uuid,
  joined_at timestamptz,
  tier smallint,
  aggression_score double precision,
  role_preference text,
  seconds_since_last_seen double precision,
  plan text,
  playstyle_tags jsonb,
  match_prefs jsonb
)
language sql
security definer
set search_path = public
stable
as $$
  select
    q.user_id,
    q.joined_at,
    p.tier,
    p.aggression_score,
    p.role_preference,
    extract(epoch from (now() - p.last_seen_at)) as seconds_since_last_seen,
    p.plan,
    p.playstyle_tags,
    p.match_prefs
  from public.match_queue_entries q
  join public.profiles p on p.id = q.user_id
  where p.valorant_shard = p_shard
    and p.last_seen_at > now() - interval '90 seconds'
    and not exists (
      select 1 from public.duo_matches d
      where d.status in ('active', 'in_game')
        and (d.user_a_id = q.user_id or d.user_b_id = q.user_id)
    )
  order by q.joined_at asc;
$$;

revoke all on function public.get_match_queue_candidates(text) from public;
revoke all on function public.get_match_queue_candidates(text) from authenticated;
revoke all on function public.get_match_queue_candidates(text) from anon;
grant execute on function public.get_match_queue_candidates(text) to service_role;

-- 5) 공개 매칭 뷰 + 본인 select에 match_prefs
drop view if exists public.profiles_match_public;

create view public.profiles_match_public
with (security_barrier = true)
as
select
  id,
  playstyle_tags,
  aggression_score,
  role_preference,
  trend_summary,
  situational_notes,
  anomaly_notes,
  synergy_notes,
  match_prefs
from public.profiles;

comment on view public.profiles_match_public is
  '매칭용 공개 필드. 태그·점수·역할·Claude 노트·match_prefs';

revoke all on table public.profiles_match_public from public;
revoke all on table public.profiles_match_public from anon;
grant select on public.profiles_match_public to authenticated;
grant select on public.profiles_match_public to service_role;

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
  ranked_rating
) on table public.profiles to authenticated;

grant update (display_name) on table public.profiles to authenticated;

grant insert (
  id,
  email,
  display_name
) on table public.profiles to authenticated;
