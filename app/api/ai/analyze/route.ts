import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { forbiddenUnlessTrustedOrigin } from "@/lib/security/apiGuards";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { analyzePlaystyleWithGemini } from "@/lib/analysis/gemini";
import {
  aggregatePlaystyleInput,
  ANALYSIS_MATCH_SELECT,
  MIN_MATCHES_FOR_ANALYSIS,
  type StoredMatchRow,
} from "@/lib/analysis/aggregate";

// 유저별 재분석 쿨다운 — Gemini 무료 티어 쿼터 보호.
// 전적은 5분 쿨다운이지만 AI 분석은 훨씬 무거워서 1시간으로 잡았습니다.
const ANALYZE_COOLDOWN_MS = 60 * 60 * 1000;

// 분산 rate limit이 아니라 인스턴스 단위지만, 없는 것보단 훨씬 낫습니다.
const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 60_000;
const GLOBAL_RATE_LIMIT = 15;

function getAnalyzeCooldownRemaining(lastAnalyzedAt: string | null): number {
  if (!lastAnalyzedAt) {
    return 0;
  }

  const elapsed = Date.now() - new Date(lastAnalyzedAt).getTime();
  const remaining = ANALYZE_COOLDOWN_MS - elapsed;
  return remaining > 0 ? remaining : 0;
}

// POST /api/ai/analyze
// 저장된 Valorant 전적을 집계 → Gemini 분석 → profiles에 저장
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

  // Gemini 무료 티어 전체 쿼터 보호 (유저 합산)
  const globalLimit = checkRateLimit("ai-analyze:global", GLOBAL_RATE_LIMIT, RATE_WINDOW_MS);
  if (!globalLimit.allowed) {
    return Response.json(
      { ok: false, errorKey: "rate_limit", retryAfterSec: globalLimit.retryAfterSec },
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

  // DB에 저장된 전적만 사용 — 여기서 Riot API를 다시 치지 않습니다.
  // (전적이 오래됐으면 유저가 먼저 「전적 불러오기」를 누르면 됨)
  const { data: matches, error: matchesError } = await admin
    .from("valorant_matches")
    .select(ANALYSIS_MATCH_SELECT)
    .eq("user_id", user.id)
    .order("played_at", { ascending: false })
    .limit(10);

  if (matchesError) {
    return Response.json({ ok: false, errorKey: "server_error" }, { status: 500 });
  }

  if (!matches || matches.length < MIN_MATCHES_FOR_ANALYSIS) {
    return Response.json(
      { ok: false, errorKey: "not_enough_matches", required: MIN_MATCHES_FOR_ANALYSIS },
      { status: 400 },
    );
  }

  // 지금은 free/premium 모두 Gemini — Claude(프리미엄)는 유료 플랜 출시 때 분기 예정
  const input = aggregatePlaystyleInput(matches as StoredMatchRow[]);
  const analysis = await analyzePlaystyleWithGemini(input);

  // Gemini 실패(한도 초과 등) 시 빈 태그가 돌아옴 — 저장하지 않고 재시도 유도.
  // (빈 결과를 저장하면 기존 분석 결과를 덮어써 버립니다)
  if (analysis.playstyle_tags.length === 0) {
    return Response.json(
      { ok: false, errorKey: "analysis_unavailable" },
      { status: 503 },
    );
  }

  const { error: saveError } = await admin.rpc("save_playstyle_analysis", {
    p_user_id: user.id,
    p_playstyle_tags: analysis.playstyle_tags,
    p_aggression_score: analysis.aggression_score,
    p_role_preference: analysis.role_preference,
    p_analysis_source: "gemini",
  });

  if (saveError) {
    // 020 migration 미실행이면 RPC가 없어서 여기로 옵니다
    console.warn("[ai-analyze] save failed:", saveError.message);
    return Response.json({ ok: false, errorKey: "server_error" }, { status: 500 });
  }

  return Response.json({
    ok: true,
    analysis: {
      playstyle_tags: analysis.playstyle_tags,
      aggression_score: analysis.aggression_score,
      role_preference: analysis.role_preference,
      analysis_source: "gemini",
    },
    matchCount: input.matchCount,
    cooldownSec: Math.ceil(ANALYZE_COOLDOWN_MS / 1000),
  });
}
