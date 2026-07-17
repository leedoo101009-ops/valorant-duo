import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { forbiddenUnlessTrustedOrigin } from "@/lib/security/apiGuards";
import { createClient } from "@/lib/supabase/server";
import {
  fetchRiotAccountByRiotId,
  formatRiotId,
  parseRiotId,
} from "@/lib/riot/api";
import {
  collectRecentValorantMatches,
  getSyncCooldownRemaining,
  SYNC_COOLDOWN_MS,
} from "@/lib/riot/valorant";
import { syncProfileTier } from "@/lib/riot/syncTier";
import {
  setValorantShard,
  touchLastMatchSyncAt as touchLastMatchSyncRpc,
} from "@/lib/supabase/profileServerWrites";
import { checkRateLimit } from "@/lib/security/rateLimit";

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;

const MATCH_SELECT =
  "id, match_id, map_name, queue_id, agent_name, kills, deaths, assists, score, rounds_played, won, played_at";

async function fetchSavedMatches(admin: ReturnType<typeof createAdminClient>, userId: string) {
  const { data } = await admin
    .from("valorant_matches")
    .select(MATCH_SELECT)
    .eq("user_id", userId)
    .order("played_at", { ascending: false })
    .limit(10);

  return data ?? [];
}

async function recordMatchSyncAttempt(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<string> {
  // 실패해도 쿨다운을 걸어 Riot 쿼터 남용을 막습니다 (025 RPC).
  const result = await touchLastMatchSyncRpc(admin, userId);
  return result.syncedAt ?? new Date().toISOString();
}

async function saveValorantShard(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  shard: string | null | undefined,
) {
  if (!shard) {
    return null;
  }

  await setValorantShard(admin, userId, shard);
  return shard;
}

async function refreshProfileTier(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  puuid: string,
  shard: string | null | undefined,
) {
  if (!shard) {
    return null;
  }

  const { tier } = await syncProfileTier(admin, userId, puuid, shard);
  return tier;
}

async function resolveRiotPuuid(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  riotId: string | null,
  riotPuuid: string | null,
): Promise<{ puuid: string | null; errorKey?: string }> {
  // riotPuuid가 null이면 riot_id로 새로 발급 (forceRefresh)
  if (riotPuuid) {
    return { puuid: riotPuuid };
  }

  if (!riotId) {
    return { puuid: null, errorKey: "riot_required" };
  }

  const parsed = parseRiotId(riotId);
  if (!parsed) {
    return { puuid: null, errorKey: "riot_required" };
  }

  const { account } = await fetchRiotAccountByRiotId(parsed.gameName, parsed.tagLine);
  if (!account) {
    return { puuid: null, errorKey: "riot_required" };
  }

  // 이미 다른 유저가 같은 puuid를 쓰고 있으면 전적을 가져오면 안 됩니다.
  const { data: owner } = await admin
    .from("profiles")
    .select("id")
    .eq("riot_puuid", account.puuid)
    .maybeSingle();

  if (owner && owner.id !== userId) {
    return { puuid: null, errorKey: "riot_already_linked" };
  }

  const { error } = await admin.rpc("link_riot_account", {
    p_user_id: userId,
    p_riot_id: formatRiotId(account),
    p_riot_puuid: account.puuid,
  });

  if (error) {
    if (error.code === "23505") {
      return { puuid: null, errorKey: "riot_already_linked" };
    }
    return { puuid: null, errorKey: "riot_required" };
  }

  return { puuid: account.puuid };
}

// POST /api/valorant/sync
// 로그인한 유저의 Riot 전적을 Riot API에서 가져와 DB에 저장합니다.
export async function POST(request: Request) {
  const originBlock = forbiddenUnlessTrustedOrigin(request);
  if (originBlock) {
    return originBlock;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ ok: false, errorKey: "login_required" }, { status: 401 });
  }

  const { allowed, retryAfterSec } = checkRateLimit(
    `valorant-sync:${user.id}`,
    RATE_LIMIT,
    RATE_WINDOW_MS,
  );

  if (!allowed) {
    return Response.json(
      { ok: false, errorKey: "rate_limit", retryAfterSec },
      { status: 429 },
    );
  }

  // 전역 쿼터 보호 — 서버리스라도 인스턴스 단위로 과도한 호출을 줄입니다.
  const globalLimit = checkRateLimit("valorant-sync:global", 30, RATE_WINDOW_MS);
  if (!globalLimit.allowed) {
    return Response.json(
      {
        ok: false,
        errorKey: "rate_limit",
        retryAfterSec: globalLimit.retryAfterSec,
      },
      { status: 429 },
    );
  }

  if (!hasAdminClient()) {
    return Response.json({ ok: false, errorKey: "server_error" }, { status: 503 });
  }

  const admin = createAdminClient();

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("riot_id, riot_puuid, last_match_sync_at")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    return Response.json({ ok: false, errorKey: "profile_not_found" }, { status: 404 });
  }

  if (!profile.riot_id) {
    return Response.json({ ok: false, errorKey: "riot_required" }, { status: 400 });
  }

  const cooldownMs = getSyncCooldownRemaining(profile.last_match_sync_at);
  if (cooldownMs > 0) {
    // 전적이 아직 없는 유저는 재시도를 빨리 허용하되,
    // 최소 60초는 기다리게 해서 Riot 쿼터 남용(무한 재시도)을 막습니다.
    const { count: savedCount } = await admin
      .from("valorant_matches")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    const hasMatches = (savedCount ?? 0) > 0;
    const elapsedMs = SYNC_COOLDOWN_MS - cooldownMs;
    const minRetryMs = 60_000;
    const blocked = hasMatches || elapsedMs < minRetryMs;

    if (blocked) {
      const waitMs = hasMatches ? cooldownMs : minRetryMs - elapsedMs;
      return Response.json(
        {
          ok: false,
          errorKey: "sync_cooldown",
          retryAfterSec: Math.ceil(waitMs / 1000),
        },
        { status: 429 },
      );
    }
  }

  const { puuid: riotPuuid, errorKey: resolveError } = await resolveRiotPuuid(
    admin,
    user.id,
    profile.riot_id,
    profile.riot_puuid,
  );

  if (!riotPuuid) {
    return Response.json(
      { ok: false, errorKey: resolveError ?? "riot_required" },
      { status: resolveError === "riot_already_linked" ? 409 : 400 },
    );
  }

  let {
    matches,
    fetched,
    skipped,
    shard,
    errorKey,
    status: riotStatus,
  } = await collectRecentValorantMatches(riotPuuid);

  // ⚠️ puuid는 API 키별로 암호화됩니다. 키를 바꾸면(개발 키 → Production Key)
  // 예전 키로 저장해 둔 puuid는 "Exception decrypting" 400이 납니다.
  // 이 경우 riot_id로 puuid를 새로 발급받아 한 번만 재시도합니다.
  const puuidLooksStale =
    matches.length === 0 && errorKey && riotStatus === 400 && profile.riot_puuid;

  if (puuidLooksStale) {
    const { puuid: freshPuuid, errorKey: refreshError } = await resolveRiotPuuid(
      admin,
      user.id,
      profile.riot_id,
      null, // 저장된 puuid 무시하고 새로 발급
    );

    if (!freshPuuid) {
      return Response.json(
        { ok: false, errorKey: refreshError ?? "riot_required" },
        { status: refreshError === "riot_already_linked" ? 409 : 400 },
      );
    }

    const retry = await collectRecentValorantMatches(freshPuuid);
    matches = retry.matches;
    fetched = retry.fetched;
    skipped = retry.skipped;
    shard = retry.shard;
    errorKey = retry.errorKey;
    riotStatus = retry.status;
  }

  // 일부 경기라도 가져왔으면 저장 (상세 조회 중 429가 나도 낭비 방지)
  if (matches.length > 0) {
    const { data: syncResult, error: syncError } = await admin.rpc("sync_valorant_matches", {
      p_user_id: user.id,
      p_matches: matches,
    });

    if (syncError) {
      return Response.json({ ok: false, errorKey: "server_error" }, { status: 500 });
    }

    const inserted =
      syncResult && typeof syncResult === "object" && "inserted" in syncResult
        ? Number((syncResult as { inserted: number }).inserted)
        : 0;

    const lastMatchSyncAt = await recordMatchSyncAttempt(admin, user.id);
    const savedMatches = await fetchSavedMatches(admin, user.id);
    const savedShard = await saveValorantShard(admin, user.id, shard);
    const tier = savedShard
      ? await refreshProfileTier(admin, user.id, riotPuuid, savedShard)
      : null;

    if (errorKey === "rate_limit") {
      return Response.json({
        ok: true,
        partial: true,
        inserted,
        fetched,
        skipped,
        total: matches.length,
        matches: savedMatches,
        lastMatchSyncAt,
        shard: savedShard,
        tier,
        warningKey: "rate_limit",
        cooldownSec: Math.ceil(SYNC_COOLDOWN_MS / 1000),
      });
    }

    return Response.json({
      ok: true,
      inserted,
      fetched,
      skipped,
      total: matches.length,
      matches: savedMatches,
      lastMatchSyncAt,
      shard: savedShard,
      tier,
      cooldownSec: Math.ceil(SYNC_COOLDOWN_MS / 1000),
    });
  }

  if (errorKey) {
    // 실패해도 항상 타임스탬프를 남깁니다.
    // (전적 없는 유저는 60초 뒤 재시도 가능 — 무한 재시도로 쿼터 태우는 것 방지)
    const lastMatchSyncAt = await recordMatchSyncAttempt(admin, user.id);

    return Response.json(
      { ok: false, errorKey, lastMatchSyncAt, shard },
      { status: riotStatus },
    );
  }

  const lastMatchSyncAt = await recordMatchSyncAttempt(admin, user.id);
  const savedShard = await saveValorantShard(admin, user.id, shard);
  const tier = savedShard
    ? await refreshProfileTier(admin, user.id, riotPuuid, savedShard)
    : null;

  return Response.json({
    ok: true,
    inserted: 0,
    fetched: 0,
    skipped,
    total: 0,
    matches: await fetchSavedMatches(admin, user.id),
    lastMatchSyncAt,
    shard: savedShard,
    tier,
  });
}
