-- Supabase SQL Editor에서 Run 하세요.
-- Phase 4-5: 매칭 무응답 자동 취소
-- 010_match_connection.sql 실행 후 적용

alter table public.duo_matches
  add column if not exists cancel_reason text;

comment on column public.duo_matches.cancel_reason is 'voice_response_timeout | manual 등';

-- 보이스 미선택 매칭 자동 취소 (service_role API만)
create or replace function public.expire_inactive_duo_matches(p_timeout_seconds integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_timeout integer;
  v_count integer;
begin
  safe_timeout := greatest(coalesce(p_timeout_seconds, 90), 30);
  safe_timeout := least(safe_timeout, 600);

  update public.duo_matches
  set
    status = 'cancelled',
    cancel_reason = 'voice_response_timeout',
    updated_at = now()
  where status = 'active'
    and created_at < now() - (safe_timeout || ' seconds')::interval
    and (
      user_a_voice_preference is null
      or user_b_voice_preference is null
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.expire_inactive_duo_matches(integer) from public;
revoke all on function public.expire_inactive_duo_matches(integer) from authenticated;
revoke all on function public.expire_inactive_duo_matches(integer) from anon;
grant execute on function public.expire_inactive_duo_matches(integer) to service_role;

-- 수동 종료 시 cancel_reason 기록
create or replace function public.dismiss_duo_match(p_user_id uuid, p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null or p_match_id is null then
    raise exception 'user_id and match_id required';
  end if;

  update public.duo_matches
  set
    status = 'completed',
    cancel_reason = 'manual'
  where id = p_match_id
    and status = 'active'
    and (user_a_id = p_user_id or user_b_id = p_user_id);

  if not found then
    raise exception 'match_not_found';
  end if;
end;
$$;

revoke all on function public.dismiss_duo_match(uuid, uuid) from public;
revoke all on function public.dismiss_duo_match(uuid, uuid) from authenticated;
revoke all on function public.dismiss_duo_match(uuid, uuid) from anon;
grant execute on function public.dismiss_duo_match(uuid, uuid) to service_role;
