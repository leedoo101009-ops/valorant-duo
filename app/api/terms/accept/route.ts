import { recordTermsAcceptance } from "@/lib/legal/recordTermsAcceptance";
import { CURRENT_TERMS_VERSION } from "@/lib/legal/terms";
import { forbiddenUnlessTrustedOrigin } from "@/lib/security/apiGuards";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { createClient } from "@/lib/supabase/server";

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

/**
 * POST — 이메일 회원가입 직후 약관 동의 기록
 * 시각은 서버 RPC(now())만 사용. 클라이언트가 보낸 timestamp는 받지 않음.
 */
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
    `terms_accept:${user.id}`,
    RATE_LIMIT,
    RATE_WINDOW_MS,
  );

  if (!allowed) {
    return Response.json(
      { ok: false, errorKey: "rate_limit", retryAfterSec },
      { status: 429 },
    );
  }

  const ok = await recordTermsAcceptance(user.id);
  if (!ok) {
    return Response.json({ ok: false, errorKey: "server_error" }, { status: 503 });
  }

  return Response.json({ ok: true, termsVersion: CURRENT_TERMS_VERSION });
}
