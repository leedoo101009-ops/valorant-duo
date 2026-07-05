-- Supabase SQL Editor에서 Run 하세요.
-- Phase 2-3: Valorant 전적 저장 + 보안 (service_role 전용 쓰기)

-- 1) profiles: 마지막 전적 동기화 시각 (rate limit용, 민감하지 않음)
alter table public.profiles
  add column if not exists last_match_sync_at timestamptz;

comment on column public.profiles.last_match_sync_at is '마지막 Valorant 전적 동기화 시각';

-- 2) valorant_matches 테이블
create table if not exists public.valorant_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  match_id text not null,
  map_name text not null,
  queue_id text not null,
  agent_name text not null,
  kills integer not null default 0,
  deaths integer not null default 0,
  assists integer not null default 0,
  score integer not null default 0,
  rounds_played integer not null default 0,
  won boolean not null default false,
  played_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint valorant_matches_user_match_unique unique (user_id, match_id)
);

create index if not exists valorant_matches_user_played_at_idx
  on public.valorant_matches (user_id, played_at desc);

comment on table public.valorant_matches is '유저별 Valorant 매치 스냅샷 (Phase 3 AI 분석용)';

-- 3) RLS — 본인 전적만 읽기, 쓰기는 service_role RPC만
alter table public.valorant_matches enable row level security;

drop policy if exists "valorant_matches_select_own" on public.valorant_matches;
create policy "valorant_matches_select_own"
  on public.valorant_matches
  for select
  to authenticated
  using (auth.uid() = user_id);

revoke all on table public.valorant_matches from authenticated;
grant select on table public.valorant_matches to authenticated;

-- 4) 전적 저장 RPC (API Route → service_role만 호출)
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
begin
  if p_user_id is null then
    raise exception 'user_id required';
  end if;

  if p_matches is null or jsonb_typeof(p_matches) <> 'array' then
    raise exception 'matches must be a json array';
  end if;

  for m in select * from jsonb_array_elements(p_matches)
  loop
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
      coalesce(m->>'map_name', 'Unknown'),
      coalesce(m->>'queue_id', 'unknown'),
      coalesce(m->>'agent_name', 'Unknown'),
      coalesce((m->>'kills')::integer, 0),
      coalesce((m->>'deaths')::integer, 0),
      coalesce((m->>'assists')::integer, 0),
      coalesce((m->>'score')::integer, 0),
      coalesce((m->>'rounds_played')::integer, 0),
      coalesce((m->>'won')::boolean, false),
      coalesce((m->>'played_at')::timestamptz, now())
    )
    on conflict (user_id, match_id) do nothing;

    get diagnostics row_count = row_count;
    inserted_count := inserted_count + row_count;
  end loop;

  update public.profiles
  set last_match_sync_at = now()
  where id = p_user_id;

  return jsonb_build_object(
    'inserted', inserted_count,
    'requested', jsonb_array_length(p_matches)
  );
end;
$$;

revoke all on function public.sync_valorant_matches(uuid, jsonb) from public;
revoke all on function public.sync_valorant_matches(uuid, jsonb) from authenticated;
revoke all on function public.sync_valorant_matches(uuid, jsonb) from anon;
grant execute on function public.sync_valorant_matches(uuid, jsonb) to service_role;

-- 5) profiles select 권한에 last_match_sync_at 추가
revoke all on table public.profiles from authenticated;

grant select (
  id,
  email,
  display_name,
  riot_id,
  discord_username,
  discord_id,
  created_at,
  updated_at,
  last_match_sync_at
) on table public.profiles to authenticated;

grant update (display_name) on table public.profiles to authenticated;

grant insert (
  id,
  email,
  display_name
) on table public.profiles to authenticated;
