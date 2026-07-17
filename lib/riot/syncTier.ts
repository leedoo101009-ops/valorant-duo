import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchValorantCompetitiveTier } from "@/lib/riot/rank";
import { setProfileTier } from "@/lib/supabase/profileServerWrites";
import { checkRateLimit } from "@/lib/security/rateLimit";

const TIER_SYNC_RATE_LIMIT = 10;
const TIER_SYNC_WINDOW_MS = 60 * 60 * 1000;

// profiles.tier를 Riot 랭크 API 결과로 갱신 (service_role 전용)
export async function syncProfileTier(
  admin: SupabaseClient,
  userId: string,
  puuid: string,
  shard: string,
  options?: { force?: boolean },
): Promise<{ tier: number | null; synced: boolean }> {
  if (!options?.force) {
    const { allowed } = checkRateLimit(
      `tier-sync:${userId}`,
      TIER_SYNC_RATE_LIMIT,
      TIER_SYNC_WINDOW_MS,
    );

    if (!allowed) {
      const { data: profile } = await admin
        .from("profiles")
        .select("tier")
        .eq("id", userId)
        .maybeSingle();

      return { tier: (profile?.tier as number | null) ?? null, synced: false };
    }
  }

  const { tierIndex, errorKey } = await fetchValorantCompetitiveTier(puuid, shard);

  if (errorKey) {
    const { data: profile } = await admin
      .from("profiles")
      .select("tier")
      .eq("id", userId)
      .maybeSingle();

    return { tier: (profile?.tier as number | null) ?? null, synced: false };
  }

  const saved = await setProfileTier(admin, userId, tierIndex);
  if (!saved.ok) {
    const { data: profile } = await admin
      .from("profiles")
      .select("tier")
      .eq("id", userId)
      .maybeSingle();

    return { tier: (profile?.tier as number | null) ?? null, synced: false };
  }

  return { tier: tierIndex, synced: true };
}
