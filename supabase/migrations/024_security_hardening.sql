-- Supabase SQL Editor에서 Run 하세요.
-- 023_rule_based_and_claude_notes.sql 실행 후 적용
--
-- 보안 강화:
--   1) profiles_match_public — anon/public 접근 명시 차단
--   2) tier / valorant_shard — 서버 RPC로만 변경 (트리거 방어)
--   3) save_playstyle_analysis — 태그·역할·노트 길이 검증

-- 1) 매칭 공개 뷰 — 023에서 drop/create 후 revoke가 빠져 있었음
revoke all on table public.profiles_match_public from public;
revoke all on table public.profiles_match_public from anon;
grant select on table public.profiles_match_public to authenticated;
grant select on table public.profiles_match_public to service_role;

-- 2) tier / shard 직접 UPDATE 차단 + RPC 추가
--    set_valorant_shard → app.writing_shard
--    set_profile_tier    → app.writing_tier
--    link_riot / unlink  → app.linking_riot (shard 포함)

create or replace function public.set_valorant_shard(
  p_user_id uuid,
  p_shard text
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

  if p_shard is null or length(trim(p_shard)) = 0 then
    raise exception 'shard required';
  end if;

  if length(p_shard) > 16 then
    raise exception 'shard too long';
  end if;

  perform set_config('app.writing_shard', 'true', true);

  update public.profiles
  set valorant_shard = lower(trim(p_shard)), updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'profile_not_found';
  end if;
end;
$$;

revoke all on function public.set_valorant_shard(uuid, text) from public;
revoke all on function public.set_valorant_shard(uuid, text) from authenticated;
revoke all on function public.set_valorant_shard(uuid, text) from anon;
grant execute on function public.set_valorant_shard(uuid, text) to service_role;

-- tier 갱신 — Riot competitiveupdates 결과만 서버에서 저장
create or replace function public.set_profile_tier(
  p_user_id uuid,
  p_tier integer
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

  perform set_config('app.writing_tier', 'true', true);

  update public.profiles
  set tier = p_tier, updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'profile_not_found';
  end if;
end;
$$;

revoke all on function public.set_profile_tier(uuid, integer) from public;
revoke all on function public.set_profile_tier(uuid, integer) from authenticated;
revoke all on function public.set_profile_tier(uuid, integer) from anon;
grant execute on function public.set_profile_tier(uuid, integer) to service_role;

-- set_valorant_shard는 app.writing_shard 플래그 — linking_riot과 별도
-- block 트리거에서 writing_shard일 때 shard 변경 허용
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
    if new.tier is distinct from old.tier then
      raise exception 'Tier must be updated via server API';
    end if;
  end if;

  return new;
end;
$$;

-- 3) save_playstyle_analysis 입력 검증 강화
create or replace function public.save_playstyle_analysis(
  p_user_id uuid,
  p_playstyle_tags jsonb,
  p_aggression_score double precision,
  p_role_preference text,
  p_analysis_source text,
  p_trend_summary text default null,
  p_situational_notes text default null,
  p_anomaly_notes text default null,
  p_synergy_notes text default null
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
    last_analyzed_at = now(),
    updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'profile_not_found';
  end if;
end;
$$;

revoke all on function public.save_playstyle_analysis(
  uuid, jsonb, double precision, text, text, text, text, text, text
) from public;
revoke all on function public.save_playstyle_analysis(
  uuid, jsonb, double precision, text, text, text, text, text, text
) from authenticated;
revoke all on function public.save_playstyle_analysis(
  uuid, jsonb, double precision, text, text, text, text, text, text
) from anon;
grant execute on function public.save_playstyle_analysis(
  uuid, jsonb, double precision, text, text, text, text, text, text
) to service_role;
