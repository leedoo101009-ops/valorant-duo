// POST /api/matching/queue — 큐 입장 + findBestMatch 궁합 매칭 (STEP 6)
//
// 흐름:
//   1) 인증 + rate limit + 온라인 갱신
//   2) join_match_queue RPC (큐 등록)
//   3) get_match_queue_candidates → findBestMatch → create_duo_match (동시성 안전)
//   4) 매칭 성공 → 매치/상대 정보 반환 | 실패 → 대기 상태 반환
//
// 기존 /api/match/queue/join 도 이 핸들러를 재사용합니다 (경로만 다름).

import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { forbiddenUnlessTrustedOrigin } from "@/lib/security/apiGuards";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { fetchRiotAccountByRiotId, formatRiotId, parseRiotId } from "@/lib/riot/api";
import { fetchValorantActiveShard } from "@/lib/riot/valorant";
import {
  shouldReanalyze,
  runAnalysis,
  normalizePlan,
  type SchedulerUser,
} from "@/lib/analysis/scheduler";
import { attemptSmartMatch } from "@/lib/matching/runMatch";
import { fetchPartnerWithReputation } from "@/lib/match/review";

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;
const RIOT_GLOBAL_LIMIT = 30;

function mapJoinError(message: string): { errorKey: string; cooldownUntil?: string } {
  if (message.includes("riot_required")) return { errorKey: "riot_required" };
  if (message.includes("riot_already_linked")) return { errorKey: "riot_already_linked" };
  if (message.includes("valorant_shard_required")) return { errorKey: "valorant_shard_required" };
  if (message.includes("offline_required")) return { errorKey: "offline_required" };
  if (message.includes("profile_not_found")) return { errorKey: "profile_not_found" };
  if (message.includes("active_match_exists")) return { errorKey: "active_match_exists" };

  if (message.includes("match_cooldown_active")) {
    const parts = message.split("match_cooldown_active:");
    const cooldownUntil = parts[1]?.trim();
    return { errorKey: "match_cooldown_active", cooldownUntil };
  }

  return { errorKey: "join_failed" };
}

async function ensureValorantShard(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<{ ok: boolean; errorKey?: string; retryAfterSec?: number }> {
  const { data: profile } = await admin
    .from("profiles")
    .select("riot_id, riot_puuid, valorant_shard")
    .eq("id", userId)
    .maybeSingle();

  if (!profile?.riot_id) {
    return { ok: false, errorKey: "riot_required" };
  }

  const riotId = profile.riot_id;

  if (profile.valorant_shard) {
    return { ok: true };
  }

  const globalRiotLimit = checkRateLimit(
    "match-queue-active-shard:global",
    RIOT_GLOBAL_LIMIT,
    RATE_WINDOW_MS,
  );

  if (!globalRiotLimit.allowed) {
    return {
      ok: false,
      errorKey: "rate_limit",
      retryAfterSec: globalRiotLimit.retryAfterSec,
    };
  }

  let puuid = profile.riot_puuid as string | null;

  async function refreshPuuidFromRiotId(): Promise<string | null> {
    const parsed = parseRiotId(riotId);
    if (!parsed) {
      return null;
    }

    const { account } = await fetchRiotAccountByRiotId(parsed.gameName, parsed.tagLine);
    if (!account) {
      return null;
    }

    const { error } = await admin.rpc("link_riot_account", {
      p_user_id: userId,
      p_riot_id: formatRiotId(account),
      p_riot_puuid: account.puuid,
    });

    if (error) {
      throw new Error(error.code === "23505" ? "riot_already_linked" : "riot_required");
    }

    return account.puuid;
  }

  if (!puuid) {
    try {
      puuid = await refreshPuuidFromRiotId();
    } catch (error) {
      return {
        ok: false,
        errorKey: error instanceof Error ? error.message : "riot_required",
      };
    }
    if (!puuid) {
      return { ok: false, errorKey: "riot_required" };
    }
  }

  const initialShard = await fetchValorantActiveShard(puuid);
  let { shard, errorKey } = initialShard;

  if (!shard && initialShard.status === 400) {
    let freshPuuid: string | null = null;
    try {
      freshPuuid = await refreshPuuidFromRiotId();
    } catch (error) {
      return {
        ok: false,
        errorKey: error instanceof Error ? error.message : "riot_required",
      };
    }
    if (freshPuuid) {
      const retry = await fetchValorantActiveShard(freshPuuid);
      shard = retry.shard;
      errorKey = retry.errorKey;
    }
  }

  if (!shard) {
    return { ok: false, errorKey: errorKey ?? "valorant_shard_required" };
  }

  const { error: updateError } = await admin
    .from("profiles")
    .update({ valorant_shard: shard })
    .eq("id", userId);

  if (updateError) {
    return { ok: false, errorKey: "server_error" };
  }

  return { ok: true };
}

// 매칭 성공 시 상대 프로필 + AI 태그(공개 뷰) 조회
async function buildPartnerMatchPayload(
  admin: ReturnType<typeof createAdminClient>,
  partnerId: string,
  synergyScore: number | null,
) {
  const [partner, playstyle] = await Promise.all([
    fetchPartnerWithReputation(partnerId),
    admin
      .from("profiles_match_public")
      .select("playstyle_tags, aggression_score, role_preference, synergy_notes")
      .eq("id", partnerId)
      .maybeSingle(),
  ]);

  if (!partner) {
    return null;
  }

  return {
    displayName: partner.displayName,
    riotId: partner.riotId,
    discordUsername: partner.discordUsername,
    discordId: partner.discordId,
    reputation: partner.reputation,
    playstyle: playstyle.data
      ? {
          tags: playstyle.data.playstyle_tags ?? [],
          aggressionScore: playstyle.data.aggression_score,
          rolePreference: playstyle.data.role_preference,
          synergyNotes: playstyle.data.synergy_notes,
        }
      : null,
    synergyScore,
    // 파티 링크는 매칭 직후 connecting 단계에서 유저가 직접 입력합니다.
    partyCode: null as string | null,
    partyInviteLink: null as string | null,
  };
}

function scheduleBackgroundAnalysis(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
) {
  void (async () => {
    try {
      const { data: analysisProfile } = await admin
        .from("profiles")
        .select("plan, last_analyzed_at")
        .eq("id", userId)
        .maybeSingle();

      if (!analysisProfile) return;

      const schedulerUser: SchedulerUser = {
        id: userId,
        plan: normalizePlan(analysisProfile.plan as string | null),
        last_analyzed_at: analysisProfile.last_analyzed_at as string | null,
      };

      if (shouldReanalyze(schedulerUser)) {
        await runAnalysis(schedulerUser, admin);
      }
    } catch {
      // 분석 실패는 큐/매칭에 영향 없음
    }
  })();
}

export async function handleQueuePost(request: Request): Promise<Response> {
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
    `match-queue-join:${user.id}`,
    RATE_LIMIT,
    RATE_WINDOW_MS,
  );

  if (!allowed) {
    return Response.json(
      { ok: false, errorKey: "rate_limit", retryAfterSec },
      { status: 429 },
    );
  }

  if (!hasAdminClient()) {
    return Response.json({ ok: false, errorKey: "server_error" }, { status: 503 });
  }

  const admin = createAdminClient();

  await admin.rpc("touch_presence", { p_user_id: user.id });

  const shard = await ensureValorantShard(admin, user.id);
  if (!shard.ok) {
    return Response.json(
      {
        ok: false,
        errorKey: shard.errorKey ?? "valorant_shard_required",
        retryAfterSec: shard.retryAfterSec,
      },
      { status: shard.errorKey === "rate_limit" ? 429 : 400 },
    );
  }

  const { error: joinError } = await admin.rpc("join_match_queue", {
    p_user_id: user.id,
  });

  if (joinError) {
    const mapped = mapJoinError(joinError.message ?? "");
    return Response.json(
      { ok: false, ...mapped },
      { status: mapped.errorKey === "match_cooldown_active" ? 403 : 400 },
    );
  }

  // STEP 5 findBestMatch + STEP 6 매칭 시도
  // create_duo_match가 동시 요청을 잠금으로 처리 — 한쪽만 성공, 다른 쪽은 matched:false
  let matchResult = { matched: false, matchId: null, partnerId: null, synergyScore: null } as Awaited<
    ReturnType<typeof attemptSmartMatch>
  >;

  try {
    matchResult = await attemptSmartMatch(admin, user.id);
  } catch {
    // 매칭 계산 실패해도 큐 등록은 유지
  }

  scheduleBackgroundAnalysis(admin, user.id);

  const { data: queueCount } = await supabase.rpc("count_queue_users");
  const count = typeof queueCount === "number" ? queueCount : 0;

  if (matchResult.matched && matchResult.matchId && matchResult.partnerId) {
    const partner = await buildPartnerMatchPayload(
      admin,
      matchResult.partnerId,
      matchResult.synergyScore,
    );

    return Response.json({
      ok: true,
      matched: true,
      inQueue: false,
      queueCount: count,
      matchId: matchResult.matchId,
      phase: "connecting",
      partner,
      messageKey: "match_found",
    });
  }

  const { data: entry } = await admin
    .from("match_queue_entries")
    .select("joined_at")
    .eq("user_id", user.id)
    .maybeSingle();

  return Response.json({
    ok: true,
    matched: false,
    inQueue: true,
    queueCount: count,
    joinedAt: entry?.joined_at ?? new Date().toISOString(),
    messageKey: "waiting_for_match",
  });
}
