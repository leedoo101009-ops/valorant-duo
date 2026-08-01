import "server-only";

import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { CURRENT_TERMS_VERSION } from "@/lib/legal/terms";

/**
 * 서버에서만 호출 — profiles에 동의 시각/버전을 남김.
 * 이미 기록이 있으면 RPC가 no-op (idempotent).
 */
export async function recordTermsAcceptance(userId: string): Promise<boolean> {
  if (!hasAdminClient()) {
    return false;
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("record_terms_acceptance", {
    p_user_id: userId,
    p_terms_version: CURRENT_TERMS_VERSION,
  });

  return !error;
}
