import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/security/rateLimit";

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;

// POST /api/match/dismiss
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ ok: false, errorKey: "login_required" }, { status: 401 });
  }

  const { allowed, retryAfterSec } = checkRateLimit(
    `match-dismiss:${user.id}`,
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

  if (!body.matchId) {
    return Response.json({ ok: false, errorKey: "invalid_request" }, { status: 400 });
  }

  if (!hasAdminClient()) {
    return Response.json({ ok: false, errorKey: "server_error" }, { status: 503 });
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("dismiss_duo_match", {
    p_user_id: user.id,
    p_match_id: body.matchId,
  });

  if (error) {
    if (error.message.includes("match_not_found")) {
      return Response.json({ ok: false, errorKey: "match_not_found" }, { status: 404 });
    }

    return Response.json({ ok: false, errorKey: "dismiss_failed" }, { status: 500 });
  }

  return Response.json({ ok: true });
}
