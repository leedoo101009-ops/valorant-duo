-- Supabase SQL Editor에서 Run 하세요.
-- Phase 4-6: 매칭 중 상대(또는 본인) 사이트 이탈 시 자동 취소
-- 011_match_timeout.sql 실행 후 적용

alter table public.duo_matches
  add column if not exists offline_user_id uuid references public.profiles (id) on delete set null;

comment on column public.duo_matches.offline_user_id is 'partner_offline 취소 시 먼저 나간 유저';

-- 탭 닫기 등 즉시 이탈 처리 (service_role API)
create or replace function public.mark_user_offline(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    return;
  end if;

  update public.profiles
  set last_seen_at = null
  where id = p_user_id;
end;
$$;

revoke all on function public.mark_user_offline(uuid) from public;
revoke all on function public.mark_user_offline(uuid) from authenticated;
revoke all on function public.mark_user_offline(uuid) from anon;
grant execute on function public.mark_user_offline(uuid) to service_role;

create or replace function public.cancel_duo_match_for_offline_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    return;
  end if;

  update public.duo_matches
  set
    status = 'cancelled',
    cancel_reason = 'partner_offline',
    offline_user_id = p_user_id
  where status = 'active'
    and (user_a_id = p_user_id or user_b_id = p_user_id);
end;
$$;

revoke all on function public.cancel_duo_match_for_offline_user(uuid) from public;
revoke all on function public.cancel_duo_match_for_offline_user(uuid) from authenticated;
revoke all on function public.cancel_duo_match_for_offline_user(uuid) from anon;
grant execute on function public.cancel_duo_match_for_offline_user(uuid) to service_role;

-- heartbeat 중단 등으로 오프라인 판정 (status poll 백업)
create or replace function public.expire_offline_duo_matches(p_threshold_seconds integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_threshold integer;
  v_count integer;
  v_total integer := 0;
begin
  safe_threshold := greatest(coalesce(p_threshold_seconds, 90), 30);
  safe_threshold := least(safe_threshold, 600);

  update public.duo_matches m
  set
    status = 'cancelled',
    cancel_reason = 'partner_offline',
    offline_user_id = m.user_a_id
  from public.profiles pa, public.profiles pb
  where m.status = 'active'
    and pa.id = m.user_a_id
    and pb.id = m.user_b_id
    and (
      pa.last_seen_at is null
      or pa.last_seen_at < now() - (safe_threshold || ' seconds')::interval
    )
    and pb.last_seen_at > now() - (safe_threshold || ' seconds')::interval;

  get diagnostics v_count = row_count;
  v_total := v_total + v_count;

  update public.duo_matches m
  set
    status = 'cancelled',
    cancel_reason = 'partner_offline',
    offline_user_id = m.user_b_id
  from public.profiles pa, public.profiles pb
  where m.status = 'active'
    and pa.id = m.user_a_id
    and pb.id = m.user_b_id
    and pa.last_seen_at > now() - (safe_threshold || ' seconds')::interval
    and (
      pb.last_seen_at is null
      or pb.last_seen_at < now() - (safe_threshold || ' seconds')::interval
    );

  get diagnostics v_count = row_count;
  v_total := v_total + v_count;

  update public.duo_matches m
  set
    status = 'cancelled',
    cancel_reason = 'partner_offline',
    offline_user_id = null
  from public.profiles pa, public.profiles pb
  where m.status = 'active'
    and pa.id = m.user_a_id
    and pb.id = m.user_b_id
    and (
      pa.last_seen_at is null
      or pa.last_seen_at < now() - (safe_threshold || ' seconds')::interval
    )
    and (
      pb.last_seen_at is null
      or pb.last_seen_at < now() - (safe_threshold || ' seconds')::interval
    );

  get diagnostics v_count = row_count;
  v_total := v_total + v_count;

  return v_total;
end;
$$;

revoke all on function public.expire_offline_duo_matches(integer) from public;
revoke all on function public.expire_offline_duo_matches(integer) from authenticated;
revoke all on function public.expire_offline_duo_matches(integer) from anon;
grant execute on function public.expire_offline_duo_matches(integer) to service_role;
