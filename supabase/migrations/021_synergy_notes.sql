-- Supabase SQL Editor에서 Run 하세요.
-- Phase 5-2: Claude synergy_notes 저장 + save_playstyle_analysis RPC 확장
-- 020_ai_playstyle_profile.sql 실행 후 적용

-- 1) profiles에 synergy_notes 컬럼 추가
--    Claude 전용(Gemini는 없음) — free 유저는 항상 null
alter table public.profiles
  add column if not exists synergy_notes text;

comment on column public.profiles.synergy_notes is
  'Claude AI가 분석한 파트너 궁합 한 줄 설명. premium 플랜 전용.';

-- 2) 기존 save_playstyle_analysis(5개 파라미터) 삭제 후 재생성(6개)
--    PostgreSQL은 파라미터 수가 다르면 다른 함수로 봐서 replace 불가 → drop 필요.
drop function if exists public.save_playstyle_analysis(uuid, jsonb, double precision, text, text);

create or replace function public.save_playstyle_analysis(
  p_user_id        uuid,
  p_playstyle_tags jsonb,
  p_aggression_score double precision,
  p_role_preference  text,
  p_analysis_source  text,
  p_synergy_notes    text default null  -- Gemini 호출 시 생략 가능
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

  -- synergy_notes는 Claude 전용이지만 빈 문자열로 오면 null로 저장
  perform set_config('app.writing_analysis', 'true', true);

  update public.profiles
  set
    playstyle_tags   = p_playstyle_tags,
    aggression_score = p_aggression_score,
    role_preference  = nullif(trim(coalesce(p_role_preference, '')), ''),
    analysis_source  = p_analysis_source,
    -- synergy_notes: null이면 그대로 null(Gemini), 문자열이면 trimming 후 저장
    synergy_notes    = nullif(trim(coalesce(p_synergy_notes, '')), ''),
    last_analyzed_at = now(),
    updated_at       = now()
  where id = p_user_id;

  if not found then
    raise exception 'profile_not_found';
  end if;
end;
$$;

revoke all on function public.save_playstyle_analysis(uuid, jsonb, double precision, text, text, text) from public;
revoke all on function public.save_playstyle_analysis(uuid, jsonb, double precision, text, text, text) from authenticated;
revoke all on function public.save_playstyle_analysis(uuid, jsonb, double precision, text, text, text) from anon;
grant execute on function public.save_playstyle_analysis(uuid, jsonb, double precision, text, text, text) to service_role;

-- 3) 매칭 공개 뷰 재정의 — synergy_notes는 민감하지 않아 공개 포함
--    (어떤 성향의 파트너를 원하는지 → 매칭 알고리즘에서 활용)
create or replace view public.profiles_match_public
with (security_barrier = true)
as
select
  id,
  playstyle_tags,
  aggression_score,
  role_preference,
  synergy_notes
from public.profiles;

comment on view public.profiles_match_public is
  '매칭 로직용 공개 필드. 인증 유저는 타 유저의 태그·점수·역할·시너지 설명만 조회';

-- 4) 본인 프로필 select 권한에 synergy_notes 추가
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
  synergy_notes
) on table public.profiles to authenticated;

grant update (display_name) on table public.profiles to authenticated;

grant insert (
  id,
  email,
  display_name
) on table public.profiles to authenticated;
