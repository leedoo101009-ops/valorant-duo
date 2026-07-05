import { createClient } from "@/lib/supabase/server";
import { ONLINE_THRESHOLD_SECONDS } from "@/lib/presence/constants";

// GET /api/presence/online
// 최근 heartbeat 기준 온라인 유저 수 (개인정보 미포함)
export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("count_online_users", {
    p_threshold_seconds: ONLINE_THRESHOLD_SECONDS,
  });

  if (error) {
    return Response.json({ ok: false, message: "Failed to fetch online count" }, { status: 500 });
  }

  return Response.json({
    ok: true,
    count: typeof data === "number" ? data : 0,
    thresholdSeconds: ONLINE_THRESHOLD_SECONDS,
  });
}
