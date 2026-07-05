import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/security/rateLimit";

const RATE_LIMIT = 2;
const RATE_WINDOW_MS = 20_000;

// POST /api/presence/heartbeat
// 로그인한 유저의 last_seen_at 갱신 (30초마다 클라이언트가 호출)
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ ok: false, message: "Login required" }, { status: 401 });
  }

  const { allowed, retryAfterSec } = checkRateLimit(
    `presence-heartbeat:${user.id}`,
    RATE_LIMIT,
    RATE_WINDOW_MS,
  );

  if (!allowed) {
    return Response.json(
      { ok: false, message: `Try again in ${retryAfterSec}s.` },
      { status: 429 },
    );
  }

  if (!hasAdminClient()) {
    return Response.json({ ok: false, message: "Server configuration error" }, { status: 503 });
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("touch_presence", { p_user_id: user.id });

  if (error) {
    return Response.json({ ok: false, message: "Failed to update presence" }, { status: 500 });
  }

  return Response.json({ ok: true });
}
