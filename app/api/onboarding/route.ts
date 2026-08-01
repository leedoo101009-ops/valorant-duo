import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { forbiddenUnlessTrustedOrigin } from "@/lib/security/apiGuards";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/security/rateLimit";

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

export type DuoGoal = "rank_up" | "casual_duo" | "any";

const DUO_GOALS = new Set<DuoGoal>(["rank_up", "casual_duo", "any"]);

/**
 * GET  — 온보딩 상태
 * POST — { duoGoal?, complete?, skipRiot? }
 *   - duoGoal만: 1단계 저장
 *   - complete + skipRiot: 「나중에 할게요」→ 온보딩 완료, riot_linked=false
 *   - complete (연동 후): 온보딩 완료 (riot_linked는 link RPC가 true로 맞춤)
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ ok: false, errorKey: "login_required" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("duo_goal, riot_linked, onboarding_completed, riot_id")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    return Response.json({ ok: false, errorKey: "server_error" }, { status: 500 });
  }

  return Response.json({
    ok: true,
    duoGoal: data?.duo_goal ?? null,
    riotLinked: Boolean(data?.riot_linked ?? data?.riot_id),
    onboardingCompleted: Boolean(data?.onboarding_completed),
    hasRiotId: Boolean(data?.riot_id),
  });
}

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
    `onboarding:${user.id}`,
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

  let body: {
    duoGoal?: string;
    complete?: boolean;
    skipRiot?: boolean;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, errorKey: "invalid_body" }, { status: 400 });
  }

  const duoGoal =
    body.duoGoal === undefined
      ? null
      : DUO_GOALS.has(body.duoGoal as DuoGoal)
        ? (body.duoGoal as DuoGoal)
        : null;

  if (body.duoGoal !== undefined && duoGoal === null) {
    return Response.json({ ok: false, errorKey: "invalid_duo_goal" }, { status: 400 });
  }

  // 완료만 요청할 때 duo_goal이 아직 없으면 거부
  if (body.complete) {
    const { data: current } = await supabase
      .from("profiles")
      .select("duo_goal")
      .eq("id", user.id)
      .maybeSingle();

    const effectiveGoal = duoGoal ?? (current?.duo_goal as DuoGoal | null);
    if (!effectiveGoal) {
      return Response.json({ ok: false, errorKey: "duo_goal_required" }, { status: 400 });
    }
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("save_onboarding", {
    p_user_id: user.id,
    p_duo_goal: duoGoal,
    p_complete: Boolean(body.complete),
    p_riot_skipped: Boolean(body.skipRiot),
  });

  if (error) {
    return Response.json({ ok: false, errorKey: "server_error" }, { status: 500 });
  }

  return Response.json({ ok: true });
}
