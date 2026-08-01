-- 034: 약관 동의 시각·버전 기록 (가입 시 서버가 now()로 저장)
--
-- 왜 클라이언트가 시각을 직접 못 쓰게 하나?
--   브라우저에서 과거/미래 시각을 조작할 수 있음 → 증거용 기록이 신뢰가 안 됨.
--   service_role RPC만 now()를 찍게 둠.

alter table public.profiles
  add column if not exists terms_accepted_at timestamptz;

alter table public.profiles
  add column if not exists terms_version text;

comment on column public.profiles.terms_accepted_at is
  '약관 동의 시각 (서버 now()). null이면 미기록.';
comment on column public.profiles.terms_version is
  '동의한 약관 버전 문자열 (예: 2026-08-01)';

-- 이미 온보딩 끝난 기존 유저: 가입 시점이 곧 동의로 간주 (백필)
-- 신규 가입은 앱에서 RPC로 정확히 찍음.
update public.profiles
set
  terms_accepted_at = coalesce(terms_accepted_at, created_at, now()),
  terms_version = coalesce(terms_version, 'legacy')
where onboarding_completed = true
  and terms_accepted_at is null;

create or replace function public.record_terms_acceptance(
  p_user_id uuid,
  p_terms_version text
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

  if p_terms_version is null or length(trim(p_terms_version)) = 0 then
    raise exception 'terms_version required';
  end if;

  -- 너무 긴 문자열로 DB 오염 방지
  if length(p_terms_version) > 32 then
    raise exception 'terms_version too long';
  end if;

  -- 이미 동의한 사람은 덮지 않음 (재시도·중복 호출 안전 / idempotent)
  update public.profiles
  set
    terms_accepted_at = now(),
    terms_version = trim(p_terms_version),
    updated_at = now()
  where id = p_user_id
    and terms_accepted_at is null;
end;
$$;

revoke all on function public.record_terms_acceptance(uuid, text) from public;
revoke all on function public.record_terms_acceptance(uuid, text) from authenticated;
revoke all on function public.record_terms_acceptance(uuid, text) from anon;
grant execute on function public.record_terms_acceptance(uuid, text) to service_role;

-- 본인이 동의 기록 조회 가능 (관리/프로필용)
grant select (terms_accepted_at, terms_version) on table public.profiles to authenticated;
