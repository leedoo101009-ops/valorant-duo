-- 035: profiles_match_public — Security Definer View 경고 해소
--
-- 문제:
--   Postgres 뷰 기본값이 SECURITY DEFINER라서, 조회자가 아니라
--   뷰 생성자 권한으로 실행됨 → profiles RLS를 우회할 수 있음.
--
-- 해결:
--   1) security_invoker = true  → 조회자 권한 + RLS 적용
--   2) authenticated 권한 제거 → 클라이언트 API로 뷰 직접 조회 불가
--      (앱은 service_role/admin 으로만 이 뷰를 씀 — handleQueuePost)
--   3) security_barrier 유지 → 뷰 조건이 먼저 적용되도록

drop view if exists public.profiles_match_public;

create view public.profiles_match_public
with (security_invoker = true, security_barrier = true)
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
  '매칭용 공개 필드(서버 전용). security_invoker=on — RLS 적용. service_role만 SELECT.';

revoke all on table public.profiles_match_public from public;
revoke all on table public.profiles_match_public from anon;
revoke all on table public.profiles_match_public from authenticated;
grant select on public.profiles_match_public to service_role;
