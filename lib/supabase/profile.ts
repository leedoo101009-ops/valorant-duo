// 클라이언트(프로필 페이지)에 노출되는 프로필 타입
// riot_puuid는 서버 전용 — 브라우저로 보내지 않습니다.
export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  riot_id: string | null;
  discord_username: string | null;
  discord_id: string | null;
  last_match_sync_at?: string | null;
  last_seen_at?: string | null;
  trust_score?: number | null;
  review_count?: number | null;
  created_at: string;
  updated_at: string;
};

export const emptyProfileConnections = {
  riot_id: null,
  discord_username: null,
  discord_id: null,
} as const;

// 로그인한 유저의 profiles 행이 없으면 만들어 줍니다.
export async function ensureProfile(
  supabase: ReturnType<typeof import("@/lib/supabase/client").createClient>,
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
