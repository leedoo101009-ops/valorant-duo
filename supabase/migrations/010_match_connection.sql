-- Supabase SQL Editor에서 Run 하세요.
-- Phase 4-4: 매칭 후 연결 방식 선택 (보이스 / 파티 코드 / Discord 연결)
-- 009_duo_matching.sql 실행 후 적용

alter table public.duo_matches
  add column if not exists user_a_voice_preference text
    check (user_a_voice_preference in ('valorant', 'discord', 'none')),
  add column if not exists user_b_voice_preference text
    check (user_b_voice_preference in ('valorant', 'discord', 'none')),
  add column if not exists party_code text,
  add column if not exists party_code_by uuid references public.profiles (id) on delete set null;

comment on column public.duo_matches.user_a_voice_preference is 'user_a의 보이스 선택: valorant / discord / none';
comment on column public.duo_matches.user_b_voice_preference is 'user_b의 보이스 선택: valorant / discord / none';
comment on column public.duo_matches.party_code is '유저가 직접 공유한 Valorant 파티 코드';
comment on column public.duo_matches.party_code_by is '파티 코드를 마지막으로 공유한 유저';

-- 매칭 참가자만 연결 정보를 바꿀 수 있게 API(service_role) 전용 RPC로 처리합니다.
create or replace function public.update_match_connection(
  p_user_id uuid,
  p_match_id uuid,
  p_voice_preference text default null,
  p_party_code text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_user_a boolean;
  v_party_code_by uuid;
  v_clean_party_code text;
begin
  if p_user_id is null or p_match_id is null then
    raise exception 'user_id and match_id required';
  end if;

  select (user_a_id = p_user_id), party_code_by
  into v_is_user_a, v_party_code_by
  from public.duo_matches
  where id = p_match_id
    and status = 'active'
    and (user_a_id = p_user_id or user_b_id = p_user_id);

  if v_is_user_a is null then
    raise exception 'match_not_found';
  end if;

  if p_voice_preference is not null
     and p_voice_preference not in ('valorant', 'discord', 'none') then
    raise exception 'invalid_voice_preference';
  end if;

  if p_party_code is not null then
    v_clean_party_code := upper(trim(p_party_code));

    if v_clean_party_code !~ '^[A-Z0-9_-]{4,32}$' then
      raise exception 'invalid_party_code';
    end if;

    -- 이미 다른 참가자가 공유한 코드는 덮어쓸 수 없음
    if v_party_code_by is not null and v_party_code_by <> p_user_id then
      raise exception 'party_code_locked';
    end if;
  end if;

  update public.duo_matches
  set
    user_a_voice_preference = case
      when p_voice_preference is not null and v_is_user_a then p_voice_preference
      else user_a_voice_preference
    end,
    user_b_voice_preference = case
      when p_voice_preference is not null and not v_is_user_a then p_voice_preference
      else user_b_voice_preference
    end,
    party_code = coalesce(v_clean_party_code, party_code),
    party_code_by = case
      when v_clean_party_code is not null then p_user_id
      else party_code_by
    end
  where id = p_match_id
    and status = 'active';
end;
$$;

revoke all on function public.update_match_connection(uuid, uuid, text, text) from public;
revoke all on function public.update_match_connection(uuid, uuid, text, text) from authenticated;
revoke all on function public.update_match_connection(uuid, uuid, text, text) from anon;
grant execute on function public.update_match_connection(uuid, uuid, text, text) to service_role;
