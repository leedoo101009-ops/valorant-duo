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
): Promise<{ ok: boolean; error?: string }> {
  if (tier !== null && (!Number.isInteger(tier) || tier < 0 || tier > 26)) {
    return { ok: false, error: "invalid_tier" };
  }

  const { error } = await admin.rpc("set_profile_tier", {
    p_user_id: userId,
    p_tier: tier,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

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
