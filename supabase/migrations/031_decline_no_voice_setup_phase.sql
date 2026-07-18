-- Supabase SQL Editor에서 Run 하세요.
-- 030_no_voice_decline_no_penalty.sql 실행 후 적용
--
-- 보안 패치: decline_partner_no_voice 가 connecting 단계만 허용하던 것을
-- setup 단계도 허용하도록 수정
--
-- 왜 필요한가?
--   connecting 단계에서 목소리 선택하고 setup으로 넘어간 경우,
--   상대가 'none'이면 페널티 없이 나가야 하는데
--   setup 단계에서는 decline_partner_no_voice 가 match_not_found 를 던졌음.
--   클라이언트는 fallback으로 cancel_duo_match_setup 을 호출하고 거기서
--   no-voice 스킵 처리하지만, 전용 RPC와 경로를 통일하는 게 더 안전.

create or replace function public.decline_partner_no_voice(
  p_user_id uuid,
  p_match_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_my_voice     text;
  v_partner_voice text;
  v_found        boolean;
begin
  if p_user_id is null or p_match_id is null then
    raise exception 'user_id and match_id required';
  end if;

  select
    case when user_a_id = p_user_id
         then user_a_voice_preference
         else user_b_voice_preference end,
    case when user_a_id = p_user_id
         then user_b_voice_preference
         else user_a_voice_preference end
  into v_my_voice, v_partner_voice
  from public.duo_matches
  where id          = p_match_id
    and status      = 'active'
    -- connecting + setup 둘 다 허용
    and match_phase in ('connecting', 'setup')
    and (user_a_id = p_user_id or user_b_id = p_user_id);

  if v_my_voice is null then
    raise exception 'match_not_found';
  end if;

  -- 상대만 no voice 인 거절 상황인지 서버에서 재확인
  if v_partner_voice is distinct from 'none'
    or v_my_voice = 'none' then
    raise exception 'no_voice_decline_not_allowed';
  end if;

  update public.duo_matches
  set
    status               = 'cancelled',
    cancel_reason        = 'no_voice_declined',
    cancelled_by_user_id = p_user_id
  where id     = p_match_id
    and status = 'active'
    and (user_a_id = p_user_id or user_b_id = p_user_id)
  returning true into v_found;

  if not v_found then
    raise exception 'match_not_found';
  end if;

  -- 페널티 없음 (의도적으로 apply_match_penalty 호출 안 함)
end;
$$;

-- 권한: service_role 만 호출 가능 (API route → admin client 경유)
revoke all on function public.decline_partner_no_voice(uuid, uuid) from public;
revoke all on function public.decline_partner_no_voice(uuid, uuid) from authenticated;
revoke all on function public.decline_partner_no_voice(uuid, uuid) from anon;
grant execute on function public.decline_partner_no_voice(uuid, uuid) to service_role;
