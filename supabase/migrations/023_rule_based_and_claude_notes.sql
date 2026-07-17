  -- Supabase SQL Editor에서 Run 하세요.
  -- Phase 5-4: 무료=rule_based, 프리미엄=Claude 4축 노트 분리
  -- 022_tier_and_smart_match.sql 실행 후 적용

  -- 1) 정성 분석 4축 컬럼 (기존 synergy_notes 유지 + 3개 추가)
  alter table public.profiles
    add column if not exists trend_summary text,
    add column if not exists situational_notes text,
    add column if not exists anomaly_notes text;

  comment on column public.profiles.trend_summary is
    'Claude 정성: 최근 폼/패턴 변화. premium 전용, free는 null.';
  comment on column public.profiles.situational_notes is
    'Claude 정성: 맵별 조건부 성향 (사이드 데이터 보류). premium 전용.';
  comment on column public.profiles.anomaly_notes is
    'Claude 정성: 지표 간 모순·특이점. premium 전용.';
  comment on column public.profiles.synergy_notes is
    'Claude 정성: 파트너 궁합·시나리오 전술. premium 전용.';

  -- 2) analysis_source 체크: gemini 유지(구데이터) + rule_based 추가
  alter table public.profiles
    drop constraint if exists profiles_analysis_source_check;

  alter table public.profiles
    add constraint profiles_analysis_source_check
    check (
      analysis_source is null
      or analysis_source in ('gemini', 'rule_based', 'claude')
    );

  comment on column public.profiles.analysis_source is
    '분석 소스: rule_based(무료) | claude(프리미엄) | gemini(구버전 호환)';

  -- 3) 직접 UPDATE 차단 트리거 — 4축 노트도 서버 RPC로만
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

    return new;
  end;
  $$;

  -- 4) save_playstyle_analysis RPC 재정의 (4축 파라미터)
  --    PostgreSQL: 시그니처가 바뀌면 기존 함수 drop 후 생성
  drop function if exists public.save_playstyle_analysis(uuid, jsonb, double precision, text, text, text);
  drop function if exists public.save_playstyle_analysis(uuid, jsonb, double precision, text, text);

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
  begin
    if p_user_id is null then
      raise exception 'user_id required';
    end if;

    if p_playstyle_tags is null or jsonb_typeof(p_playstyle_tags) <> 'array' then
      raise exception 'playstyle_tags must be a json array';
    end if;

    if p_aggression_score is null
      or p_aggression_score < 0
      or p_aggression_score > 1 then
      raise exception 'aggression_score must be between 0 and 1';
    end if;

    -- gemini는 구버전 호환용으로만 허용 (신규 free는 rule_based)
    if p_analysis_source is null
      or p_analysis_source not in ('gemini', 'rule_based', 'claude') then
      raise exception 'invalid analysis_source';
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

  -- 5) 매칭 공개 뷰 — 4축 노트 포함 (민감정보 아님)
  --    CREATE OR REPLACE VIEW는 기존 컬럼 순서/이름을 바꿀 수 없음
  --    (예전 5번째가 synergy_notes → 지금은 trend_summary 라서 42P16 에러)
  --    → drop 후 새로 생성
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
    synergy_notes
  from public.profiles;

  comment on view public.profiles_match_public is
    '매칭용 공개 필드. 태그·점수·역할·Claude 4축 노트';

  -- 뷰는 기본적으로 owner만 접근 — 매칭에서 인증 유저가 peer 노트 조회 가능해야 함
  revoke all on table public.profiles_match_public from public;
  revoke all on table public.profiles_match_public from anon;
  grant select on public.profiles_match_public to authenticated;
  grant select on public.profiles_match_public to service_role;

  -- 6) 본인 프로필 select 권한에 4축 컬럼 추가
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
    tier
  ) on table public.profiles to authenticated;

  grant update (display_name) on table public.profiles to authenticated;

  grant insert (
    id,
    email,
    display_name
  ) on table public.profiles to authenticated;
