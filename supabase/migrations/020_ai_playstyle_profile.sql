-- Supabase SQL Editor에서 Run 하세요.
-- Phase 5-1: AI 플레이스타일 분석용 profiles 컬럼 + RLS/권한
-- 019_valorant_shard_matching.sql 실행 후 적용

-- 1) profiles에 AI 분석 / 플랜 컬럼 추가
alter table public.profiles
  add column if not exists plan text not null default 'free'
    check (plan in ('free', 'premium')),
  add column if not exists last_analyzed_at timestamptz,
  add column if not exists playstyle_tags jsonb not null default '[]'::jsonb
    check (jsonb_typeof(playstyle_tags) = 'array'),
  add column if not exists aggression_score double precision
    check (
      aggression_score is null
      or (aggression_score >= 0 and aggression_score <= 1)
    ),
  add column if not exists role_preference text,
  add column if not exists analysis_source text
    check (
      analysis_source is null
      or analysis_source in ('gemini', 'claude')
    );

comment on column public.profiles.plan is '요금 플랜 (free | premium). 결제/서버 RPC로만 변경';
comment on column public.profiles.last_analyzed_at is '마지막 AI 플레이스타일 분석 실행 시각';
comment on column public.profiles.playstyle_tags is 'AI가 분석한 플레이스타일 태그 배열 (예: ["공격형", "엔트리"])';
comment on column public.profiles.aggression_score is '공격성 점수 0.0~1.0';
comment on column public.profiles.role_preference is '선호 역할군 (예: duelist, initiator)';
comment on column public.profiles.analysis_source is '분석에 사용한 모델 (gemini | claude)';

create index if not exists profiles_plan_idx
  on public.profiles (plan);

create index if not exists profiles_aggression_score_idx
  on public.profiles (aggression_score desc nulls last)
  where aggression_score is not null;

create index if not exists profiles_playstyle_tags_gin_idx
  on public.profiles using gin (playstyle_tags);

-- 2) 클라이언트가 AI/플랜 컬럼을 직접 UPDATE 하는 것 차단 (기존 Riot/Discord 트리거 확장)
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

  -- AI 분석 결과는 서버 RPC(save_playstyle_analysis)로만 저장
  if current_setting('app.writing_analysis', true) is distinct from 'true' then
    if new.last_analyzed_at is distinct from old.last_analyzed_at
       or new.playstyle_tags is distinct from old.playstyle_tags
       or new.aggression_score is distinct from old.aggression_score
       or new.role_preference is distinct from old.role_preference
       or new.analysis_source is distinct from old.analysis_source then
      raise exception 'Playstyle analysis must be saved via server API';
    end if;
  end if;

  -- 플랜 변경은 서버 RPC(set_user_plan)로만 허용
  if current_setting('app.writing_plan', true) is distinct from 'true' then
    if new.plan is distinct from old.plan then
      raise exception 'Plan must be changed via server API';
    end if;
  end if;

  return new;
end;
$$;

-- 3) AI 분석 결과 저장 RPC (API Route / service_role 전용)
create or replace function public.save_playstyle_analysis(
  p_user_id uuid,
  p_playstyle_tags jsonb,
  p_aggression_score double precision,
  p_role_preference text,
  p_analysis_source text
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

  if p_analysis_source is null
     or p_analysis_source not in ('gemini', 'claude') then
    raise exception 'invalid analysis_source';
  end if;

  perform set_config('app.writing_analysis', 'true', true);

  update public.profiles
  set
    playstyle_tags = p_playstyle_tags,
    aggression_score = p_aggression_score,
    role_preference = nullif(trim(p_role_preference), ''),
    analysis_source = p_analysis_source,
    last_analyzed_at = now(),
    updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'profile_not_found';
  end if;
end;
$$;

revoke all on function public.save_playstyle_analysis(uuid, jsonb, double precision, text, text) from public;
revoke all on function public.save_playstyle_analysis(uuid, jsonb, double precision, text, text) from authenticated;
revoke all on function public.save_playstyle_analysis(uuid, jsonb, double precision, text, text) from anon;
grant execute on function public.save_playstyle_analysis(uuid, jsonb, double precision, text, text) to service_role;

-- 4) 플랜 변경 RPC (결제 연동 전까지 서버에서만 호출)
create or replace function public.set_user_plan(
  p_user_id uuid,
  p_plan text
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

  if p_plan is null or p_plan not in ('free', 'premium') then
    raise exception 'invalid plan';
  end if;

  perform set_config('app.writing_plan', 'true', true);

  update public.profiles
  set
    plan = p_plan,
    updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'profile_not_found';
  end if;
end;
$$;

revoke all on function public.set_user_plan(uuid, text) from public;
revoke all on function public.set_user_plan(uuid, text) from authenticated;
revoke all on function public.set_user_plan(uuid, text) from anon;
grant execute on function public.set_user_plan(uuid, text) to service_role;

-- 5) 매칭용 공개 뷰 — 다른 유저의 태그/점수만 노출
-- profiles 테이블 RLS는 "본인 행만" 유지하고, 타 유저 조회는 이 뷰로 합니다.
-- (PostgreSQL column grant는 행마다 다르게 줄 수 없어서 뷰로 분리)
create or replace view public.profiles_match_public
with (security_barrier = true)
as
select
  id,
  playstyle_tags,
  aggression_score,
  role_preference
from public.profiles;

comment on view public.profiles_match_public is
  '매칭 로직용 공개 필드. 인증 유저는 타 유저의 태그/점수/역할만 조회';

revoke all on table public.profiles_match_public from public;
revoke all on table public.profiles_match_public from anon;
grant select on table public.profiles_match_public to authenticated;

-- 6) RLS 정책 (profiles 테이블)
-- - SELECT/UPDATE: 본인 행만 (타 유저 이메일·플랜 등은 직접 조회 불가)
-- - 타 유저 매칭 필드: 위 profiles_match_public 뷰 사용 (태그·점수·역할만 노출)
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = id);

-- 7) 본인 프로필 조회 권한에 AI/플랜 컬럼 추가 (타 유저 이메일 등은 여전히 본인만)
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
  analysis_source
) on table public.profiles to authenticated;

grant update (display_name) on table public.profiles to authenticated;

grant insert (
  id,
  email,
  display_name
) on table public.profiles to authenticated;
