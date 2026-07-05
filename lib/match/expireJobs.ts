import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import {
  MATCH_OFFLINE_THRESHOLD_SECONDS,
  MATCH_RESPONSE_TIMEOUT_SECONDS,
  MATCH_SETUP_TIMEOUT_SECONDS,
} from "@/lib/match/constants";

let lastExpireRunAt = 0;
const EXPIRE_INTERVAL_MS = 10_000;

// status poll마다 DB expire RPC를 돌리면 부하/남용 위험 — 인스턴스당 10초에 1번만
export async function runMatchExpireJobsIfDue(): Promise<void> {
  if (!hasAdminClient()) {
    return;
  }

  const now = Date.now();
  if (now - lastExpireRunAt < EXPIRE_INTERVAL_MS) {
    return;
  }

  lastExpireRunAt = now;
  const admin = createAdminClient();

  await admin.rpc("expire_inactive_duo_matches", {
    p_timeout_seconds: MATCH_RESPONSE_TIMEOUT_SECONDS,
  });
  await admin.rpc("expire_setup_duo_matches", {
    p_timeout_seconds: MATCH_SETUP_TIMEOUT_SECONDS,
  });
  await admin.rpc("expire_offline_duo_matches", {
    p_threshold_seconds: MATCH_OFFLINE_THRESHOLD_SECONDS,
  });
}
