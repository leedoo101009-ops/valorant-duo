import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/security/rateLimit";

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;

// POST /api/match/queue/leave
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ ok: false, errorKey: "login_required" }, { status: 401 });
  }

  const { allowed, retryAfterSec } = checkRateLimit(
    `match-queue-leave:${user.id}`,
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
  const { error } = await admin.rpc("leave_match_queue", { p_user_id: user.id });

  if (error) {
    return Response.json({ ok: false, errorKey: "leave_failed" }, { status: 500 });
  }

  const { data: queueCount } = await supabase.rpc("count_queue_users");

  return Response.json({
    ok: true,
    inQueue: false,
    queueCount: typeof queueCount === "number" ? queueCount : 0,
  });
}
