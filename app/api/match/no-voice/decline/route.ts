import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { forbiddenUnlessTrustedOrigin, parseUuid } from "@/lib/security/apiGuards";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/security/rateLimit";

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

// POST /api/match/no-voice/decline
// 상대 No Voice 거절(매칭 취소 버튼) — 페널티 없음
// 탭 닫기 이탈은 leave-on-exit → offline_leave 페널티 유지
export async function POST(request: Request) {
  const originBlock = forbiddenUnlessTrustedOrigin(request);
  if (originBlock) return originBlock;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ ok: false, errorKey: "login_required" }, { status: 401 });
  }

  const { allowed, retryAfterSec } = checkRateLimit(
    `match-no-voice-decline:${user.id}`,
    RATE_LIMIT,
    RATE_WINDOW_MS,
  );

  if (!allowed) {
    return Response.json(
      { ok: false, errorKey: "rate_limit", retryAfterSec },
      { status: 429 },
    );
  }

  let body: { matchId?: string };
  try {
    body = (await request.json()) as { matchId?: string };
  } catch {
    return Response.json({ ok: false, errorKey: "invalid_request" }, { status: 400 });
  }

  const matchId = parseUuid(body.matchId);
  if (!matchId) {
    return Response.json({ ok: false, errorKey: "invalid_request" }, { status: 400 });
  }

  if (!hasAdminClient()) {
    return Response.json({ ok: false, errorKey: "server_error" }, { status: 503 });
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("decline_partner_no_voice", {
    p_user_id: user.id,
    p_match_id: matchId,
  });

  if (error) {
    if (error.message.includes("match_not_found")) {
      return Response.json({ ok: false, errorKey: "match_not_found" }, { status: 404 });
    }
    if (error.message.includes("no_voice_decline_not_allowed")) {
      return Response.json(
        { ok: false, errorKey: "no_voice_decline_not_allowed" },
        { status: 400 },
      );
    }
    return Response.json({ ok: false, errorKey: "decline_failed" }, { status: 500 });
  }

  return Response.json({ ok: true });
}
