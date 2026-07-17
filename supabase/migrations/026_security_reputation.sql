-- Supabase SQL Editor에서 Run 하세요.
-- 025_security_presence_sync.sql 실행 후 적용
--
-- reputation / penalty 필드 — 서버 RPC(app.writing_reputation)로만 변경
--   trust_score, review_count, penalty_count, penalty_deduction, cooldown_until

-- 1) 트리거 — reputation 필드 직접 UPDATE 차단
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

-- 2) apply_reputation_score — trust_score 재계산
create or replace function public.apply_reputation_score(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_avg numeric;
  v_deduction integer;
begin
  if p_user_id is null then
    raise exception 'user_id required';
  end if;

  select coalesce(avg(review_score), 70)
  into v_avg
  from public.duo_match_reviews
  where reviewee_id = p_user_id;

  select penalty_deduction
  into v_deduction
  from public.profiles
  where id = p_user_id;

  if not found then
    raise exception 'profile_not_found';
  end if;

  perform set_config('app.writing_reputation', 'true', true);

  update public.profiles
  set
    trust_score = greatest(
      0,
      least(100, round(v_avg)::integer - coalesce(v_deduction, 0))
    )::smallint,
    updated_at = now()
  where id = p_user_id;
end;
$$;

revoke all on function public.apply_reputation_score(uuid) from public;
revoke all on function public.apply_reputation_score(uuid) from authenticated;
revoke all on function public.apply_reputation_score(uuid) from anon;
grant execute on function public.apply_reputation_score(uuid) to service_role;

-- 3) recalculate_user_reputation — review_count + trust_score
create or replace function public.recalculate_user_reputation(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_user_id is null then
    raise exception 'user_id required';
  end if;

  select count(*)
  into v_count
  from public.duo_match_reviews
  where reviewee_id = p_user_id;

  perform set_config('app.writing_reputation', 'true', true);

  update public.profiles
  set review_count = v_count
  where id = p_user_id;

  if not found then
    raise exception 'profile_not_found';
  end if;

  perform public.apply_reputation_score(p_user_id);
end;
$$;

revoke all on function public.recalculate_user_reputation(uuid) from public;
revoke all on function public.recalculate_user_reputation(uuid) from authenticated;
revoke all on function public.recalculate_user_reputation(uuid) from anon;
grant execute on function public.recalculate_user_reputation(uuid) to service_role;

-- 4) apply_match_penalty — penalty_count / deduction / cooldown / trust_score
create or replace function public.apply_match_penalty(
  p_user_id uuid,
  p_match_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_count integer;
  v_cooldown timestamptz;
  v_trust_deduction integer := 8;
begin
  if p_user_id is null then
    return;
  end if;

  if p_reason is null or p_reason not in ('manual_cancel', 'offline_leave') then
    raise exception 'invalid penalty reason';
  end if;

  perform set_config('app.writing_reputation', 'true', true);

  update public.profiles
  set
    penalty_count = penalty_count + 1,
    penalty_deduction = penalty_deduction + v_trust_deduction,
    updated_at = now()
  where id = p_user_id
  returning penalty_count into v_new_count;

  if v_new_count is null then
    return;
  end if;

  perform public.apply_reputation_score(p_user_id);

  if v_new_count >= 5 then
    v_cooldown := now() + interval '15 minutes';
  elsif v_new_count = 4 then
    v_cooldown := now() + interval '5 minutes';
  else
    v_cooldown := null;
  end if;

  if v_cooldown is not null then
    update public.profiles
    set cooldown_until = v_cooldown
    where id = p_user_id;
  end if;

  insert into public.duo_match_penalties (
    user_id, match_id, reason, penalty_count_after, cooldown_until
  )
  values (
    p_user_id, p_match_id, p_reason, v_new_count, v_cooldown
  );
end;
$$;

revoke all on function public.apply_match_penalty(uuid, uuid, text) from public;
revoke all on function public.apply_match_penalty(uuid, uuid, text) from authenticated;
revoke all on function public.apply_match_penalty(uuid, uuid, text) from anon;
grant execute on function public.apply_match_penalty(uuid, uuid, text) to service_role;
