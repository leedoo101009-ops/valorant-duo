import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  collectRecentValorantMatches,
  getSyncCooldownRemaining,
  SYNC_COOLDOWN_MS,
} from "@/lib/riot/valorant";
import { checkRateLimit } from "@/lib/security/rateLimit";

const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 60_000;

// POST /api/valorant/sync
// 로그인한 유저의 Riot 전적을 Riot API에서 가져와 DB에 저장합니다.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ ok: false, message: "Login required" }, { status: 401 });
  }

  const { allowed, retryAfterSec } = checkRateLimit(
    `valorant-sync:${user.id}`,
    RATE_LIMIT,
    RATE_WINDOW_MS,
  );

  if (!allowed) {
    return Response.json(
      { ok: false, message: `Too many requests. Try again in ${retryAfterSec}s.` },
      { status: 429 },
    );
  }

  if (!hasAdminClient()) {
    return Response.json({ ok: false, message: "Server configuration error" }, { status: 503 });
  }

  const admin = createAdminClient();

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("riot_puuid, last_match_sync_at")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    return Response.json({ ok: false, message: "Profile not found" }, { status: 404 });
  }

  if (!profile.riot_puuid) {
    return Response.json(
      { ok: false, message: "Link your Riot account first" },
      { status: 400 },
    );
  }

  const cooldownMs = getSyncCooldownRemaining(profile.last_match_sync_at);
  if (cooldownMs > 0) {
    const waitSec = Math.ceil(cooldownMs / 1000);
    return Response.json(
      {
        ok: false,
        message: `Please wait ${waitSec}s before syncing again.`,
        retryAfterSec: waitSec,
      },
      { status: 429 },
    );
  }

  const {
    matches,
    fetched,
    skipped,
    errorKey,
    status: riotStatus,
  } = await collectRecentValorantMatches(profile.riot_puuid);

  if (errorKey && matches.length === 0) {
    return Response.json({ ok: false, errorKey, message: errorKey }, { status: riotStatus });
  }

  if (matches.length === 0) {
    await admin
      .from("profiles")
      .update({ last_match_sync_at: new Date().toISOString() })
      .eq("id", user.id);

    return Response.json({
      ok: true,
      inserted: 0,
      fetched: 0,
      skipped,
      total: 0,
      message: "No recent matches found",
    });
  }

  const { data: syncResult, error: syncError } = await admin.rpc("sync_valorant_matches", {
    p_user_id: user.id,
    p_matches: matches,
  });

  if (syncError) {
    return Response.json(
      { ok: false, message: "Failed to save match history" },
      { status: 500 },
    );
  }

  const inserted =
    syncResult && typeof syncResult === "object" && "inserted" in syncResult
      ? Number((syncResult as { inserted: number }).inserted)
      : 0;

  return Response.json({
    ok: true,
    inserted,
    fetched,
    skipped,
    total: matches.length,
    cooldownSec: Math.ceil(SYNC_COOLDOWN_MS / 1000),
  });
}
