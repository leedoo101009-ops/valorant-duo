-- Supabase SQL Editor에서 이 파일 전체를 붙여넣고 Run 하세요.
-- Phase 2-1: 라이엇 / 디스코드 연동용 컬럼 추가

alter table public.profiles
  add column if not exists riot_id text,
  add column if not exists riot_puuid text,
  add column if not exists discord_username text,
  add column if not exists discord_id text;

comment on column public.profiles.riot_id is 'Riot ID 표시용 (예: PlayerName#KR1)';
comment on column public.profiles.riot_puuid is 'Riot API 호출용 고유 ID';
comment on column public.profiles.discord_username is 'Discord 유저명';
comment on column public.profiles.discord_id is 'Discord 고유 ID';

-- 같은 라이엇/디스코드 계정이 두 유저에 연결되는 것 방지
create unique index if not exists profiles_riot_puuid_unique
  on public.profiles (riot_puuid)
  where riot_puuid is not null;

create unique index if not exists profiles_discord_id_unique
  on public.profiles (discord_id)
  where discord_id is not null;

-- RLS는 001_profiles.sql 정책 그대로 적용됨 (본인 row만 select/update)
-- 새 컬럼도 auth.uid() = id 조건으로 보호됩니다.
