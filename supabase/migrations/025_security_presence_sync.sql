-- Supabase SQL Editor에서 Run 하세요.
-- 024_security_hardening.sql 실행 후 적용
--
-- 보안 강화:
--   1) last_seen_at / last_match_sync_at — 서버 RPC로만 변경
--   2) sync_valorant_matches — 배열 크기·문자열 길이 제한 (DoS 방지)

-- 1) presence / match sync 직접 UPDATE 차단
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

  return new;
end;
$$;

-- touch_presence — app.writing_presence 플래그
create or replace function public.touch_presence(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception 'user_id required';
  end if;

  perform set_config('app.writing_presence', 'true', true);

  update public.profiles
  set last_seen_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'Profile not found';
  end if;
end;
$$;

-- mark_user_offline — last_seen_at null 허용
create or replace function public.mark_user_offline(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    return;
  end if;

  perform set_config('app.writing_presence', 'true', true);

  update public.profiles
  set last_seen_at = null
  where id = p_user_id;
end;
$$;

-- 실패 경로에서도 쿨다운 타임스탬프를 RPC로만 기록
create or replace function public.touch_last_match_sync_at(p_user_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  if p_user_id is null then
    raise exception 'user_id required';
  end if;

  perform set_config('app.writing_match_sync', 'true', true);

  update public.profiles
  set last_match_sync_at = v_now
  where id = p_user_id;

  if not found then
    raise exception 'profile_not_found';
  end if;

  return v_now;
end;
$$;

revoke all on function public.touch_last_match_sync_at(uuid) from public;
revoke all on function public.touch_last_match_sync_at(uuid) from authenticated;
revoke all on function public.touch_last_match_sync_at(uuid) from anon;
grant execute on function public.touch_last_match_sync_at(uuid) to service_role;

-- sync_valorant_matches — 입력 검증 + match sync 플래그
create or replace function public.sync_valorant_matches(
  p_user_id uuid,
  p_matches jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m jsonb;
  inserted_count integer := 0;
  row_count integer;
  v_len integer;
begin
  if p_user_id is null then
    raise exception 'user_id required';
  end if;

  if p_matches is null or jsonb_typeof(p_matches) <> 'array' then
    raise exception 'matches must be a json array';
  end if;

  v_len := jsonb_array_length(p_matches);
  if v_len < 1 or v_len > 20 then
    raise exception 'matches array size invalid';
  end if;

  for m in select value from jsonb_array_elements(p_matches)
  loop
    if length(coalesce(m->>'match_id', '')) = 0
      or length(m->>'match_id') > 64 then
      raise exception 'invalid match_id';
    end if;

    if length(coalesce(m->>'map_name', '')) > 64
      or length(coalesce(m->>'queue_id', '')) > 32
      or length(coalesce(m->>'agent_name', '')) > 32 then
      raise exception 'match field too long';
    end if;

    insert into public.valorant_matches (
      user_id,
      match_id,
      map_name,
      queue_id,
      agent_name,
      kills,
      deaths,
      assists,
      score,
      rounds_played,
      won,
      played_at
    ) values (
      p_user_id,
      m->>'match_id',
      coalesce(nullif(trim(m->>'map_name'), ''), 'Unknown'),
      coalesce(nullif(trim(m->>'queue_id'), ''), 'unknown'),
      coalesce(nullif(trim(m->>'agent_name'), ''), 'Unknown'),
      greatest(coalesce((m->>'kills')::integer, 0), 0),
      greatest(coalesce((m->>'deaths')::integer, 0), 0),
      greatest(coalesce((m->>'assists')::integer, 0), 0),
      greatest(coalesce((m->>'score')::integer, 0), 0),
      greatest(coalesce((m->>'rounds_played')::integer, 0), 0),
      coalesce((m->>'won')::boolean, false),
      coalesce((m->>'played_at')::timestamptz, now())
    )
    on conflict (user_id, match_id) do nothing;

    get diagnostics row_count = row_count;
    inserted_count := inserted_count + row_count;
  end loop;

  perform set_config('app.writing_match_sync', 'true', true);

  update public.profiles
  set last_match_sync_at = now()
  where id = p_user_id;

  return jsonb_build_object(
    'inserted', inserted_count,
    'requested', v_len
  );
end;
$$;

revoke all on function public.sync_valorant_matches(uuid, jsonb) from public;
revoke all on function public.sync_valorant_matches(uuid, jsonb) from authenticated;
revoke all on function public.sync_valorant_matches(uuid, jsonb) from anon;
grant execute on function public.sync_valorant_matches(uuid, jsonb) to service_role;
