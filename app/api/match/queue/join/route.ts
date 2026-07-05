import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { forbiddenUnlessTrustedOrigin } from "@/lib/security/apiGuards";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/security/rateLimit";

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;

function mapJoinError(message: string): string {
  if (message.includes("riot_required")) return "riot_required";
  if (message.includes("offline_required")) return "offline_required";
  if (message.includes("profile_not_found")) return "profile_not_found";
  if (message.includes("active_match_exists")) return "active_match_exists";
  return "join_failed";
}

// POST /api/match/queue/join
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
  const { error } = await admin.rpc("join_match_queue", { p_user_id: user.id });

  if (error) {
    return Response.json(
      { ok: false, errorKey: mapJoinError(error.message) },
      { status: 400 },
    );
  }

  await admin.rpc("process_match_queue");

  const { data: queueCount } = await supabase.rpc("count_queue_users");

  return Response.json({
    ok: true,
    inQueue: true,
    queueCount: typeof queueCount === "number" ? queueCount : 0,
  });
}
