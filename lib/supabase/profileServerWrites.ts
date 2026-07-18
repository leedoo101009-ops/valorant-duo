import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// profiles.tier / valorant_shard는 DB 트리거로 직접 UPDATE가 막혀 있습니다.
// service_role API Route에서도 RPC를 통해서만 갱신합니다 (024 migration).

export async function setValorantShard(
  admin: SupabaseClient,
  userId: string,
  shard: string,
): Promise<{ ok: boolean; error?: string }> {
  const normalized = shard.trim().toLowerCase();
  if (!normalized || normalized.length > 16) {
    return { ok: false, error: "invalid_shard" };
  }

  const { error } = await admin.rpc("set_valorant_shard", {
    p_user_id: userId,
    p_shard: normalized,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

export async function setProfileTier(
  admin: SupabaseClient,
  userId: string,
  tier: number | null,
  rankedRating: number | null = null,
): Promise<{ ok: boolean; error?: string }> {
  if (tier !== null && (!Number.isInteger(tier) || tier < 0 || tier > 26)) {
    return { ok: false, error: "invalid_tier" };
  }

  if (
    rankedRating !== null &&
    (!Number.isInteger(rankedRating) || rankedRating < 0 || rankedRating > 9999)
  ) {
    return { ok: false, error: "invalid_ranked_rating" };
  }

  // 027 migration: set_profile_tier(user, tier, ranked_rating)
  // 024만 적용된 DB는 2인자 — 실패 시 tier만이라도 저장
  const withRr = await admin.rpc("set_profile_tier", {
    p_user_id: userId,
    p_tier: tier,
    p_ranked_rating: rankedRating,
  });

  if (!withRr.error) {
    return { ok: true };
  }

  const msg = withRr.error.message ?? "";
  const maybeMissingRrParam =
    msg.includes("ranked_rating") ||
    msg.includes("Could not find the function") ||
    msg.includes("function public.set_profile_tier");

  if (!maybeMissingRrParam) {
    console.warn("[setProfileTier] RPC failed:", msg);
    return { ok: false, error: msg };
  }

  const legacy = await admin.rpc("set_profile_tier", {
    p_user_id: userId,
    p_tier: tier,
  });

  if (legacy.error) {
    console.warn("[setProfileTier] legacy RPC failed:", legacy.error.message);
    return { ok: false, error: legacy.error.message };
  }

  console.warn(
    "[setProfileTier] saved tier without RR — run 027_ranked_rating.sql in Supabase",
  );
  return { ok: true };
}

export async function touchLastMatchSyncAt(
  admin: SupabaseClient,
  userId: string,
): Promise<{ ok: boolean; syncedAt?: string; error?: string }> {
  const { data, error } = await admin.rpc("touch_last_match_sync_at", {
    p_user_id: userId,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  return {
    ok: true,
    syncedAt: typeof data === "string" ? data : new Date().toISOString(),
  };
}
