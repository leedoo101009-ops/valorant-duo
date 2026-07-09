import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { forbiddenUnlessTrustedOrigin } from "@/lib/security/apiGuards";
import { createClient } from "@/lib/supabase/server";

export type PenaltyRecord = {
  id: string;
  match_id: string | null;
  reason: "manual_cancel" | "offline_leave";
  penalty_count_after: number;
  cooldown_until: string | null;
  created_at: string;
};

export type PenaltyHistoryResponse = {
  ok: boolean;
  penalties: PenaltyRecord[];
  penaltyCount: number;
  cooldownUntil: string | null;
  isCoolingDown: boolean;
};

// GET /api/match/penalty/history
export async function GET(request: Request) {
  const originBlock = forbiddenUnlessTrustedOrigin(request);
  if (originBlock) return originBlock;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ ok: false, errorKey: "login_required" }, { status: 401 });
  }

  if (!hasAdminClient()) {
    return Response.json({ ok: false, errorKey: "server_error" }, { status: 503 });
  }

  const admin = createAdminClient();

  const [penaltiesResult, cooldownResult] = await Promise.all([
    admin.rpc("get_my_penalties", { p_user_id: user.id }),
    admin.rpc("get_my_cooldown_status", { p_user_id: user.id }),
  ]);

  const penalties = (penaltiesResult.data ?? []) as PenaltyRecord[];
  const cooldown = Array.isArray(cooldownResult.data) ? cooldownResult.data[0] : null;

  return Response.json({
    ok: true,
    penalties,
    penaltyCount: (cooldown as { penalty_count?: number } | null)?.penalty_count ?? 0,
    cooldownUntil: (cooldown as { cooldown_until?: string | null } | null)?.cooldown_until ?? null,
    isCoolingDown:
      (cooldown as { is_cooling_down?: boolean } | null)?.is_cooling_down ?? false,
  } satisfies PenaltyHistoryResponse);
}
