import { runMatchExpireJobsIfDue } from "@/lib/match/expireJobs";
import {
  MATCH_RESPONSE_TIMEOUT_SECONDS,
  MATCH_SETUP_TIMEOUT_SECONDS,
} from "@/lib/match/constants";
import { fetchPartnerWithReputation, getPendingMatchReview } from "@/lib/match/review";
import type { PendingMatchReview, UserReputation } from "@/lib/reputation/types";
import {
  getDismissNoticeForUser,
  getMatchExpiresAt,
  getSecondsUntilExpiry,
  type DismissNoticeReason,
} from "@/lib/match/timeout";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { attemptSmartMatch } from "@/lib/matching/runMatch";

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

export type MatchPhase = "connecting" | "setup" | "in_game";

export type ActiveMatchResponse = {
  id: string;
  createdAt: string;
  phase: MatchPhase;
  expiresAt: string | null;
  secondsUntilExpiry: number | null;
  setupExpiresAt: string | null;
  setupSecondsUntilExpiry: number | null;
  myVoicePreference: "valorant" | "discord" | "none" | null;
  partnerVoicePreference: "valorant" | "discord" | "none" | null;
  mySetupReady: boolean;
  partnerSetupReady: boolean;
  inGameAt: string | null;
  partyCode: string | null;
  partyCodeByMe: boolean;
  myAcceptedPartnerNoVoice: boolean;
  partnerAcceptedNoVoice: boolean;
  me: {
    displayName: string | null;
    riotId: string | null;
    discordUsername: string | null;
    discordId: string | null;
  };
  partner: {
    displayName: string | null;
    riotId: string | null;
    discordUsername: string | null;
    discordId: string | null;
    reputation: UserReputation | null;
  };
};

export type PendingReviewResponse = PendingMatchReview;

export type DismissNoticeResponse = {
  matchId: string;
  reason: DismissNoticeReason;
};

async function getActiveMatchForUser(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<ActiveMatchResponse | null> {
  const { data: match } = await supabase
    .from("duo_matches")
    .select(
      "id, user_a_id, user_b_id, status, created_at, match_phase, setup_started_at, user_a_setup_ready, user_b_setup_ready, in_game_at, user_a_voice_preference, user_b_voice_preference, user_a_accepted_no_voice, user_b_accepted_no_voice, party_code, party_code_by",
    )
    .in("status", ["active", "in_game"])
    .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
    .maybeSingle();

  if (!match) {
    return null;
  }

  const partnerId = match.user_a_id === userId ? match.user_b_id : match.user_a_id;
  const isUserA = match.user_a_id === userId;
  const partnerProfile = await fetchPartnerWithReputation(partnerId);
  const { data: me } = await supabase
    .from("profiles")
    .select("display_name, riot_id, discord_username, discord_id")
    .eq("id", userId)
    .maybeSingle();

  if (!partnerProfile) {
    return null;
  }

  const myVoicePreference = isUserA
    ? match.user_a_voice_preference
    : match.user_b_voice_preference;
  const partnerVoicePreference = isUserA
    ? match.user_b_voice_preference
    : match.user_a_voice_preference;
  const mySetupReady = isUserA ? match.user_a_setup_ready : match.user_b_setup_ready;
  const partnerSetupReady = isUserA ? match.user_b_setup_ready : match.user_a_setup_ready;
  const sharePartnerDiscord = partnerVoicePreference === "discord";

  const phase = (match.match_phase ?? "connecting") as MatchPhase;
  const voiceIncomplete = !myVoicePreference || !partnerVoicePreference;
  const voiceExpiresAt =
    phase === "connecting" && voiceIncomplete
      ? getMatchExpiresAt(match.created_at, MATCH_RESPONSE_TIMEOUT_SECONDS)
      : null;
  const setupExpiresAt =
    phase === "setup" && match.setup_started_at
      ? getMatchExpiresAt(match.setup_started_at, MATCH_SETUP_TIMEOUT_SECONDS)
      : null;

  return {
    id: match.id,
    createdAt: match.created_at,
    phase,
    expiresAt: voiceExpiresAt,
    secondsUntilExpiry: voiceExpiresAt ? getSecondsUntilExpiry(voiceExpiresAt) : null,
    setupExpiresAt,
    setupSecondsUntilExpiry: setupExpiresAt ? getSecondsUntilExpiry(setupExpiresAt) : null,
    myVoicePreference,
    partnerVoicePreference,
    mySetupReady: Boolean(mySetupReady),
    partnerSetupReady: Boolean(partnerSetupReady),
    inGameAt: match.in_game_at,
    partyCode: match.party_code,
    partyCodeByMe: match.party_code_by === userId,
    myAcceptedPartnerNoVoice: isUserA
      ? Boolean(match.user_a_accepted_no_voice)
      : Boolean(match.user_b_accepted_no_voice),
    partnerAcceptedNoVoice: isUserA
      ? Boolean(match.user_b_accepted_no_voice)
      : Boolean(match.user_a_accepted_no_voice),
    me: {
      displayName: me?.display_name ?? null,
      riotId: me?.riot_id ?? null,
      discordUsername: me?.discord_username ?? null,
      discordId: me?.discord_id ?? null,
    },
    partner: {
      displayName: partnerProfile.displayName,
      riotId: partnerProfile.riotId,
      discordUsername: sharePartnerDiscord ? partnerProfile.discordUsername : null,
      discordId: sharePartnerDiscord ? partnerProfile.discordId : null,
      reputation: partnerProfile.reputation,
    },
  };
}

async function getRecentDismissNotice(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<DismissNoticeResponse | null> {
  const since = new Date(Date.now() - 3 * 60 * 1000).toISOString();

  const { data: match } = await supabase
    .from("duo_matches")
    .select(
      "id, user_a_id, user_b_id, user_a_voice_preference, user_b_voice_preference, cancel_reason, offline_user_id, cancelled_by_user_id, updated_at",
    )
    .eq("status", "cancelled")
    .in("cancel_reason", [
      "voice_response_timeout",
      "partner_offline",
      "setup_timeout",
      "setup_cancelled",
    ])
    .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
    .gte("updated_at", since)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!match) {
    return null;
  }

  return getDismissNoticeForUser(match, userId);
}

// GET /api/match/queue/status
export async function GET(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  const { allowed, retryAfterSec } = checkRateLimit(
    `match-queue-status:${ip}`,
    RATE_LIMIT,
    RATE_WINDOW_MS,
  );

  if (!allowed) {
    return Response.json(
      { ok: false, errorKey: "rate_limit", retryAfterSec },
      { status: 429 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: queueCount, error: countError } = await supabase.rpc("count_queue_users");

  if (countError) {
    return Response.json({ ok: false, errorKey: "server_error" }, { status: 500 });
  }

  const count = typeof queueCount === "number" ? queueCount : 0;

  if (!user) {
    return Response.json({
      ok: true,
      queueCount: count,
      inQueue: false,
      joinedAt: null,
      activeMatch: null,
      dismissNotice: null,
      pendingReview: null,
    });
  }

  if (hasAdminClient()) {
    try {
      await runMatchExpireJobsIfDue();
    } catch {
      // expire RPC 실패해도 status 조회는 계속
    }

    // 큐에 실제로 들어와 있는 유저만 재평가합니다.
    // (매 폴링마다 모든 접속자에게 후보 조회를 돌리면 DB 낭비 — 큐 엔트리 있을 때만)
    // 대기 시간이 길어지면 findBestMatch의 시간 완화가 동작해 하드 조건만으로도 매칭됩니다.
    try {
      const { data: queueEntry } = await supabase
        .from("match_queue_entries")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (queueEntry) {
        await attemptSmartMatch(createAdminClient(), user.id);
      }
    } catch {
      // 매칭 실패는 무시 — status 응답에는 영향 없음
    }
  }

  const activeMatch = await getActiveMatchForUser(supabase, user.id);
  const dismissNotice = activeMatch ? null : await getRecentDismissNotice(supabase, user.id);

  let pendingReview: PendingMatchReview | null = null;
  if (!activeMatch) {
    try {
      pendingReview = await getPendingMatchReview(user.id);
    } catch {
      pendingReview = null;
    }
  }

  if (activeMatch) {
    return Response.json({
      ok: true,
      queueCount: count,
      inQueue: false,
      joinedAt: null,
      activeMatch,
      dismissNotice: null,
      pendingReview: null,
    });
  }

  const { data: entry } = await supabase
    .from("match_queue_entries")
    .select("joined_at")
    .eq("user_id", user.id)
    .maybeSingle();

  return Response.json({
    ok: true,
    queueCount: count,
    inQueue: Boolean(entry),
    joinedAt: entry?.joined_at ?? null,
    activeMatch: null,
    dismissNotice,
    pendingReview,
  });
}
