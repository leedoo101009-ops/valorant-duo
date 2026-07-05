import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { forbiddenUnlessTrustedOrigin } from "@/lib/security/apiGuards";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/security/rateLimit";

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;

// POST /api/match/leave-on-exit
// 탭 닫기·페이지 이탈 시 sendBeacon으로 호출 — 활성 매칭 즉시 취소
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
    return Response.json({ ok: false }, { status: 401 });
  }

  const { allowed } = checkRateLimit(
    `match-leave-on-exit:${user.id}`,
    RATE_LIMIT,
    RATE_WINDOW_MS,
  );

  if (!allowed) {
    return Response.json({ ok: false }, { status: 429 });
  }

  if (!hasAdminClient()) {
    return Response.json({ ok: false }, { status: 503 });
  }

  const admin = createAdminClient();

  await admin.rpc("cancel_duo_match_for_offline_user", { p_user_id: user.id });
  await admin.rpc("mark_user_offline", { p_user_id: user.id });

  return Response.json({ ok: true });
}
