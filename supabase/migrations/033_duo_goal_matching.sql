-- 033: 매칭 후보에 duo_goal 포함 (온보딩 목표 → 매칭 하드 필터용)
--
-- TS matcher가 빡겜↔즐겜만 막고, any/null은 통과시킴.
-- 반환 컬럼이 늘어서 drop 후 재생성.

drop function if exists public.get_match_queue_candidates(text);

create or replace function public.get_match_queue_candidates(p_shard text)
returns table (
  user_id uuid,
  joined_at timestamptz,
  tier smallint,
  aggression_score double precision,
  role_preference text,
  seconds_since_last_seen double precision,
  plan text,
  playstyle_tags jsonb,
  match_prefs jsonb,
  duo_goal text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    q.user_id,
    q.joined_at,
    p.tier,
    p.aggression_score,
    p.role_preference,
    extract(epoch from (now() - p.last_seen_at)) as seconds_since_last_seen,
    p.plan,
    p.playstyle_tags,
    p.match_prefs,
    p.duo_goal
  from public.match_queue_entries q
  join public.profiles p on p.id = q.user_id
  where p.valorant_shard = p_shard
    and p.last_seen_at > now() - interval '90 seconds'
    and not exists (
      select 1 from public.duo_matches d
      where d.status in ('active', 'in_game')
        and (d.user_a_id = q.user_id or d.user_b_id = q.user_id)
    )
  order by q.joined_at asc;
$$;

revoke all on function public.get_match_queue_candidates(text) from public;
revoke all on function public.get_match_queue_candidates(text) from authenticated;
revoke all on function public.get_match_queue_candidates(text) from anon;
grant execute on function public.get_match_queue_candidates(text) to service_role;
