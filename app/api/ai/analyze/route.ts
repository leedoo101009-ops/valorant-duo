import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { forbiddenUnlessTrustedOrigin } from "@/lib/security/apiGuards";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { executePlanAnalysis } from "@/lib/analysis/executePlanAnalysis";
import { normalizePlan } from "@/lib/analysis/scheduler";
import { MIN_MATCHES_FOR_ANALYSIS } from "@/lib/analysis/aggregate";

// 유저별 수동 분석 쿨다운 — AI/계산 남용 방지
const ANALYZE_COOLDOWN_MS = 60 * 60 * 1000;

const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 60_000;
const GLOBAL_FREE_LIMIT = 30; // 규칙기반은 저비용 — Gemini 때보다 여유
const GLOBAL_CLAUDE_LIMIT = 10;

function getAnalyzeCooldownRemaining(lastAnalyzedAt: string | null): number {
  if (!lastAnalyzedAt) {
    return 0;
  }

  const elapsed = Date.now() - new Date(lastAnalyzedAt).getTime();
  const remaining = ANALYZE_COOLDOWN_MS - elapsed;
  return remaining > 0 ? remaining : 0;
}

// POST /api/ai/analyze
// free → 규칙기반만, premium → 규칙기반 + Claude 정성
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
    `ai-analyze:${user.id}`,
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

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("riot_id, plan, last_analyzed_at")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    return Response.json({ ok: false, errorKey: "profile_not_found" }, { status: 404 });
  }

  if (!profile.riot_id) {
    return Response.json({ ok: false, errorKey: "riot_required" }, { status: 400 });
  }

  const plan = normalizePlan(profile.plan as string | null);

  const globalLimitKey =
    plan === "premium" ? "ai-analyze:claude:global" : "ai-analyze:rule:global";
  const globalLimitMax = plan === "premium" ? GLOBAL_CLAUDE_LIMIT : GLOBAL_FREE_LIMIT;
  const globalLimit = checkRateLimit(globalLimitKey, globalLimitMax, RATE_WINDOW_MS);

  if (!globalLimit.allowed) {
    return Response.json(
      { ok: false, errorKey: "rate_limit", retryAfterSec: globalLimit.retryAfterSec },
      { status: 429 },
    );
  }

  const cooldownMs = getAnalyzeCooldownRemaining(profile.last_analyzed_at);
  if (cooldownMs > 0) {
    return Response.json(
      {
        ok: false,
        errorKey: "analyze_cooldown",
        retryAfterSec: Math.ceil(cooldownMs / 1000),
      },
      { status: 429 },
    );
  }

  const result = await executePlanAnalysis(user.id, plan, admin);

  if (!result.ok) {
    if (result.reason === "not_enough_matches") {
      return Response.json(
        { ok: false, errorKey: "not_enough_matches", required: MIN_MATCHES_FOR_ANALYSIS },
        { status: 400 },
      );
    }

    if (result.reason === "analysis_unavailable") {
      return Response.json({ ok: false, errorKey: "analysis_unavailable" }, { status: 503 });
    }

    return Response.json({ ok: false, errorKey: "server_error" }, { status: 500 });
  }

  return Response.json({
    ok: true,
    plan,
    analysis: result.analysis,
    matchCount: result.matchCount,
    cooldownSec: Math.ceil(ANALYZE_COOLDOWN_MS / 1000),
  });
}
