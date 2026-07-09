import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { forbiddenUnlessTrustedOrigin } from "@/lib/security/apiGuards";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/security/rateLimit";

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;

function mapUnlinkError(message: string): string {
  if (message.includes("active_match_exists")) return "active_match_exists";
  if (message.includes("profile_not_found")) return "profile_not_found";
  return "unlink_failed";
}

// POST /api/discord/unlink
// 프로필 필드 삭제 + Supabase Auth에서 Discord identity 분리
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
    `discord-unlink:${user.id}`,
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
  const { error: rpcError } = await admin.rpc("unlink_discord_account", {
    p_user_id: user.id,
  });

  if (rpcError) {
    const errorKey = mapUnlinkError(rpcError.message ?? "");
    return Response.json(
      { ok: false, errorKey },
      { status: errorKey === "active_match_exists" ? 409 : 400 },
    );
  }

  // Supabase Auth에서 Discord identity 분리 (재연동 시 새로 로그인 가능)
  const discordIdentity = user.identities?.find((item) => item.provider === "discord");
  if (discordIdentity) {
    const { error: authError } = await supabase.auth.unlinkIdentity(discordIdentity);
    if (authError) {
      // 프로필은 이미 해제됨 — Auth 분리 실패는 경고만 (다음 로그인 시 sync로 복구 가능)
      return Response.json({ ok: true, warningKey: "auth_unlink_partial" });
    }
  }

  return Response.json({ ok: true });
}
