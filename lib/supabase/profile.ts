// 클라이언트(프로필 페이지)에 노출되는 프로필 타입
// riot_puuid는 서버 전용 — 브라우저로 보내지 않습니다.
import type { SupabaseClient } from "@supabase/supabase-js";

export type DuoGoal = "rank_up" | "casual_duo" | "any";

export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  riot_id: string | null;
  valorant_shard?: string | null;
  discord_username: string | null;
  discord_id: string | null;
  last_match_sync_at?: string | null;
  last_seen_at?: string | null;
  trust_score?: number | null;
  review_count?: number | null;
  /** Valorant 랭크 인덱스 0~26 (Iron1=0 … Radiant=26) */
  tier?: number | null;
  /** Valorant 경쟁전 RR */
  ranked_rating?: number | null;
  /** 온보딩 목표: rank_up | casual_duo | any */
  duo_goal?: DuoGoal | null;
  /** 라이엇 연동 여부 (표시용). 실제 키는 riot_id */
  riot_linked?: boolean | null;
  /** 온보딩 완료(스킵 포함) */
  onboarding_completed?: boolean | null;
  /** 약관 동의 시각 (ISO). null이면 미기록 */
  terms_accepted_at?: string | null;
  /** 동의한 약관 버전 (예: 2026-08-01) */
  terms_version?: string | null;
  created_at: string;
  updated_at: string;
};

export const emptyProfileConnections = {
  riot_id: null,
  discord_username: null,
  discord_id: null,
} as const;

// 로그인한 유저의 profiles 행이 없으면 만들어 줍니다.
// 이메일 가입 / Google OAuth 모두에서 사용합니다.
export async function ensureProfile(
  supabase: SupabaseClient,
  user: { id: string; email?: string | null },
) {
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (existing) return;

  const fallbackName = user.email?.split("@")[0] ?? "player";

  await supabase.from("profiles").insert({
    id: user.id,
    email: user.email ?? null,
    display_name: fallbackName,
    ...emptyProfileConnections,
  });
}
