import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchValorantCompetitiveTier,
  riotTierToProfileIndex,
} from "@/lib/riot/rank";
import { setProfileTier } from "@/lib/supabase/profileServerWrites";
import { checkRateLimit } from "@/lib/security/rateLimit";

const TIER_SYNC_RATE_LIMIT = 10;
const TIER_SYNC_WINDOW_MS = 60 * 60 * 1000;

async function readStoredRank(
  admin: SupabaseClient,
  userId: string,
): Promise<{ tier: number | null; rankedRating: number | null }> {
  const { data: profile } = await admin
    .from("profiles")
    .select("tier, ranked_rating")
    .eq("id", userId)
    .maybeSingle();

  return {
    tier: (profile?.tier as number | null) ?? null,
    rankedRating: (profile?.ranked_rating as number | null) ?? null,
  };
}

// profiles.tier + ranked_rating 을 Riot 랭크 API 결과로 갱신 (service_role 전용)
// fallbackRiotTier: competitiveupdates가 비었을 때 전적 상세 competitiveTier 로 폴백
export async function syncProfileTier(
  admin: SupabaseClient,
  userId: string,
  puuid: string,
  shard: string,
  options?: { force?: boolean; fallbackRiotTier?: number | null },
): Promise<{ tier: number | null; rankedRating: number | null; synced: boolean }> {
  if (!options?.force) {
    const { allowed } = checkRateLimit(
      `tier-sync:${userId}`,
      TIER_SYNC_RATE_LIMIT,
      TIER_SYNC_WINDOW_MS,
    );

    if (!allowed) {
      const stored = await readStoredRank(admin, userId);
      return { ...stored, synced: false };
    }
  }

  const { tierIndex, rankedRating, errorKey, status } =
    await fetchValorantCompetitiveTier(puuid, shard);

  let nextTier = tierIndex;
  let nextRr = rankedRating;

  // 랭크 API가 비었거나 실패 → 전적 상세에서 뽑은 competitiveTier 사용 (RR은 없음)
  if (nextTier == null && options?.fallbackRiotTier != null) {
    const fromMatch = riotTierToProfileIndex(options.fallbackRiotTier);
    if (fromMatch != null) {
      console.warn(
        "[syncProfileTier] using match competitiveTier fallback:",
        options.fallbackRiotTier,
        "→",
        fromMatch,
      );
      nextTier = fromMatch;
      nextRr = null;
    }
  }

  if (errorKey && nextTier == null) {
    console.warn(
      "[syncProfileTier] Riot rank fetch failed:",
      errorKey,
      "status",
      status,
      "shard",
      shard,
    );
    const stored = await readStoredRank(admin, userId);
    return { ...stored, synced: false };
  }

  const saved = await setProfileTier(admin, userId, nextTier, nextRr);
  if (!saved.ok) {
    console.warn("[syncProfileTier] save failed:", saved.error);
    const stored = await readStoredRank(admin, userId);
    return { ...stored, synced: false };
  }

  if (nextTier == null) {
    console.warn(
      "[syncProfileTier] no competitive tier (unranked / no ranked games)",
      "shard",
      shard,
    );
  }

  return { tier: nextTier, rankedRating: nextRr, synced: true };
}
