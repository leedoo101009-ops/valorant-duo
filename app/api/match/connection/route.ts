import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { createClient } from "@/lib/supabase/server";

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

const voicePreferences = new Set(["valorant", "discord", "none"]);

type ConnectionBody = {
  matchId?: string;
  voicePreference?: string;
  partyCode?: string;
};

function mapConnectionError(message: string): string {
  if (message.includes("match_not_found")) return "match_not_found";
  if (message.includes("invalid_voice_preference")) return "invalid_voice_preference";
  if (message.includes("invalid_party_code")) return "invalid_party_code";
  if (message.includes("party_code_locked")) return "party_code_locked";
  return "connection_failed";
}

// POST /api/match/connection
// 매칭 참가자의 보이스 선택과 파티 코드를 저장합니다.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ ok: false, errorKey: "login_required" }, { status: 401 });
  }

  const { allowed, retryAfterSec } = checkRateLimit(
    `match-connection:${user.id}`,
    RATE_LIMIT,
    RATE_WINDOW_MS,
  );

  if (!allowed) {
    return Response.json(
      { ok: false, errorKey: "rate_limit", retryAfterSec },
      { status: 429 },
    );
  }

  let body: ConnectionBody;
  try {
    body = (await request.json()) as ConnectionBody;
  } catch {
    return Response.json({ ok: false, errorKey: "invalid_request" }, { status: 400 });
  }

  const voicePreference = body.voicePreference?.trim();
  const partyCode = body.partyCode?.trim();

  if (!body.matchId || (!voicePreference && !partyCode)) {
    return Response.json({ ok: false, errorKey: "invalid_request" }, { status: 400 });
  }

  if (voicePreference && !voicePreferences.has(voicePreference)) {
    return Response.json(
      { ok: false, errorKey: "invalid_voice_preference" },
      { status: 400 },
    );
  }

  if (partyCode && !/^[A-Za-z0-9_-]{4,32}$/.test(partyCode)) {
    return Response.json({ ok: false, errorKey: "invalid_party_code" }, { status: 400 });
  }

  if (!hasAdminClient()) {
    return Response.json({ ok: false, errorKey: "server_error" }, { status: 503 });
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("update_match_connection", {
    p_user_id: user.id,
    p_match_id: body.matchId,
    p_voice_preference: voicePreference || null,
    p_party_code: partyCode || null,
  });

  if (error) {
    return Response.json(
      { ok: false, errorKey: mapConnectionError(error.message) },
      { status: 400 },
    );
  }

  return Response.json({ ok: true });
}
