import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { forbiddenUnlessTrustedOrigin } from "@/lib/security/apiGuards";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/security/rateLimit";

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;

function mapJoinError(message: string): { errorKey: string; cooldownUntil?: string } {
  if (message.includes("riot_required")) return { errorKey: "riot_required" };
  if (message.includes("offline_required")) return { errorKey: "offline_required" };
  if (message.includes("profile_not_found")) return { errorKey: "profile_not_found" };
  if (message.includes("active_match_exists")) return { errorKey: "active_match_exists" };

  // 쿨다운: 에러 메시지 형식 "match_cooldown_active:2026-07-09T12:00:00Z"
  if (message.includes("match_cooldown_active")) {
    const parts = message.split("match_cooldown_active:");
    const cooldownUntil = parts[1]?.trim();
    return { errorKey: "match_cooldown_active", cooldownUntil };
  }

  return { errorKey: "join_failed" };
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

  // 클릭 시점에 온라인 상태 갱신 — heartbeat API 장애 시에도 큐 등록 가능
  await admin.rpc("touch_presence", { p_user_id: user.id });

  const { error } = await admin.rpc("join_match_queue", { p_user_id: user.id });

  if (error) {
    const mapped = mapJoinError(error.message ?? "");
    return Response.json(
      { ok: false, ...mapped },
      { status: mapped.errorKey === "match_cooldown_active" ? 403 : 400 },
    );
  }

  // 페어링은 best-effort — 큐 등록 성공이 우선
  await admin.rpc("process_match_queue").then(
    () => undefined,
    () => undefined,
  );

  const { data: queueCount } = await supabase.rpc("count_queue_users");

  return Response.json({
    ok: true,
    inQueue: true,
    queueCount: typeof queueCount === "number" ? queueCount : 0,
  });
}
