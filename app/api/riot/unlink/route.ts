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

// POST /api/riot/unlink
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
    `riot-unlink:${user.id}`,
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
  const { error } = await admin.rpc("unlink_riot_account", { p_user_id: user.id });

  if (error) {
    const errorKey = mapUnlinkError(error.message ?? "");
    return Response.json(
      { ok: false, errorKey },
      { status: errorKey === "active_match_exists" ? 409 : 400 },
    );
  }

  return Response.json({ ok: true });
}
