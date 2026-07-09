-- Supabase SQL Editor에서 Run 하세요.
-- Phase 4-8: 매칭 후 리뷰 + 신뢰도/매너등급
-- 014_join_queue_active_guard.sql 실행 후 적용

alter table public.profiles
  add column if not exists trust_score smallint not null default 70
    check (trust_score between 0 and 100),
  add column if not exists review_count integer not null default 0
    check (review_count >= 0);

comment on column public.profiles.trust_score is '받은 리뷰 기반 신뢰도 0~100';
comment on column public.profiles.review_count is '받은 리뷰 수 (review_count < 3 이면 신규 유저)';

create table if not exists public.duo_match_reviews (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.duo_matches (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id) on delete cascade,
  reviewee_id uuid not null references public.profiles (id) on delete cascade,
  positive_tags text[] not null default '{}',
  negative_tags text[] not null default '{}',
  review_score smallint not null check (review_score between 0 and 100),
  created_at timestamptz not null default now(),
  constraint duo_match_reviews_one_per_reviewer unique (match_id, reviewer_id),
  constraint duo_match_reviews_no_self check (reviewer_id <> reviewee_id)
);

create index if not exists duo_match_reviews_reviewee_idx
  on public.duo_match_reviews (reviewee_id);

create index if not exists duo_match_reviews_match_idx
  on public.duo_match_reviews (match_id);

comment on table public.duo_match_reviews is '듀오 매칭 종료 후 상대 평가';

alter table public.duo_match_reviews enable row level security;

create policy "duo_match_reviews_select_participant"
  on public.duo_match_reviews
  for select
  to authenticated
  using (auth.uid() = reviewer_id or auth.uid() = reviewee_id);

revoke all on table public.duo_match_reviews from authenticated;
grant select on table public.duo_match_reviews to authenticated;

-- 허용 태그 검증
create or replace function public.is_valid_review_tags(
  p_positive_tags text[],
  p_negative_tags text[]
)
returns boolean
language sql
immutable
as $$
  select
    coalesce(
      (
        select bool_and(tag = any (array[
          'friendly', 'good_comms', 'skilled', 'punctual', 'team_player'
        ]))
        from unnest(coalesce(p_positive_tags, '{}')) as tag
      ),
      true
    )
    and coalesce(
      (
        select bool_and(tag = any (array[
          'toxic', 'afk', 'bad_comms', 'griefing', 'rude'
        ]))
        from unnest(coalesce(p_negative_tags, '{}')) as tag
      ),
      true
    );
$$;

create or replace function public.compute_review_score(
  p_positive_tags text[],
  p_negative_tags text[]
)
returns smallint
language sql
immutable
as $$
  select greatest(
    0,
    least(
      100,
      50
        + coalesce(cardinality(p_positive_tags), 0) * 12
        - coalesce(cardinality(p_negative_tags), 0) * 18
    )
  )::smallint;
$$;

create or replace function public.recalculate_user_reputation(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_avg numeric;
begin
  select count(*), coalesce(avg(review_score), 70)
  into v_count, v_avg
  from public.duo_match_reviews
  where reviewee_id = p_user_id;

  update public.profiles
  set
    review_count = v_count,
    trust_score = round(v_avg)::smallint,
    updated_at = now()
  where id = p_user_id;
end;
$$;

create or replace function public.get_user_top_review_tags(
  p_user_id uuid,
  p_limit integer default 2
)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(tag order by tag_count desc, tag asc), '{}')
  from (
    select tag, count(*) as tag_count
    from (
      select unnest(positive_tags) as tag
      from public.duo_match_reviews
      where reviewee_id = p_user_id
      union all
      select unnest(negative_tags) as tag
      from public.duo_match_reviews
      where reviewee_id = p_user_id
    ) tags
    group by tag
    order by tag_count desc, tag asc
    limit greatest(p_limit, 0)
  ) ranked;
$$;

create or replace function public.get_user_review_tag_stats(p_user_id uuid)
returns table (tag text, count bigint, kind text)
language sql
stable
security definer
set search_path = public
as $$
  select tag, count(*) as count, 'positive'::text as kind
  from (
    select unnest(positive_tags) as tag
    from public.duo_match_reviews
    where reviewee_id = p_user_id
  ) positive
  group by tag

  union all

  select tag, count(*) as count, 'negative'::text as kind
  from (
    select unnest(negative_tags) as tag
    from public.duo_match_reviews
    where reviewee_id = p_user_id
  ) negative
  group by tag

  order by count desc, tag asc;
$$;

create or replace function public.submit_duo_match_review(
  p_reviewer_id uuid,
  p_match_id uuid,
  p_positive_tags text[] default '{}',
  p_negative_tags text[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.duo_matches%rowtype;
  v_reviewee_id uuid;
  v_positive text[] := coalesce(p_positive_tags, '{}');
  v_negative text[] := coalesce(p_negative_tags, '{}');
  v_score smallint;
begin
  if p_reviewer_id is null or p_match_id is null then
    raise exception 'reviewer_id and match_id required';
  end if;

  if cardinality(v_positive) = 0 and cardinality(v_negative) = 0 then
    raise exception 'tags_required';
  end if;

  if not public.is_valid_review_tags(v_positive, v_negative) then
    raise exception 'invalid_tags';
  end if;

  select *
  into v_match
  from public.duo_matches
  where id = p_match_id;

  if not found then
    raise exception 'match_not_found';
  end if;

  if v_match.status <> 'completed' then
    raise exception 'match_not_reviewable';
  end if;

  if v_match.in_game_at is null then
    raise exception 'match_not_reviewable';
  end if;

  if v_match.user_a_id <> p_reviewer_id and v_match.user_b_id <> p_reviewer_id then
    raise exception 'not_participant';
  end if;

  v_reviewee_id := case
    when v_match.user_a_id = p_reviewer_id then v_match.user_b_id
    else v_match.user_a_id
  end;

  if exists (
    select 1
    from public.duo_match_reviews
    where match_id = p_match_id
      and reviewer_id = p_reviewer_id
  ) then
    raise exception 'review_already_submitted';
  end if;

  if v_match.updated_at < now() - interval '7 days' then
    raise exception 'review_window_expired';
  end if;

  v_score := public.compute_review_score(v_positive, v_negative);

  insert into public.duo_match_reviews (
    match_id,
    reviewer_id,
    reviewee_id,
    positive_tags,
    negative_tags,
    review_score
  )
  values (
    p_match_id,
    p_reviewer_id,
    v_reviewee_id,
    v_positive,
    v_negative,
    v_score
  );

  perform public.recalculate_user_reputation(v_reviewee_id);
end;
$$;

revoke all on function public.submit_duo_match_review(uuid, uuid, text[], text[]) from public;
revoke all on function public.submit_duo_match_review(uuid, uuid, text[], text[]) from authenticated;
grant execute on function public.submit_duo_match_review(uuid, uuid, text[], text[]) to service_role;

revoke all on function public.recalculate_user_reputation(uuid) from public;
revoke all on function public.recalculate_user_reputation(uuid) from authenticated;
grant execute on function public.recalculate_user_reputation(uuid) to service_role;

revoke all on function public.get_user_top_review_tags(uuid, integer) from public;
grant execute on function public.get_user_top_review_tags(uuid, integer) to service_role;

revoke all on function public.get_user_review_tag_stats(uuid) from public;
grant execute on function public.get_user_review_tag_stats(uuid) to service_role;

-- profiles select 권한에 reputation 컬럼 추가 (본인 프로필 조회용)
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
  last_match_sync_at,
  last_seen_at,
  trust_score,
  review_count
) on table public.profiles to authenticated;

grant update (display_name) on table public.profiles to authenticated;

grant insert (
  id,
  email,
  display_name
) on table public.profiles to authenticated;
