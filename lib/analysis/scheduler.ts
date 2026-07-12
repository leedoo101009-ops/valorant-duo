// 플레이스타일 재분석 스케줄러
//
// 언제 쓰나?
//   - 유저가 매칭 큐에 들어올 때 (큐 join API에서 호출)
//   - 또는 크론잡에서 온라인 유저를 돌면서 호출
//
// 규칙:
//   - free    : 7일(주 1회) 지났으면 Gemini로 재분석
//   - premium : 3일 지났으면 Claude로 재분석
//   - last_analyzed_at이 null(최초 가입)이면 즉시 1회 분석
//
// 설계:
//   shouldReanalyze — 순수 함수. DB/네트워크 없이 입력만으로 판단 → 테스트 쉬움
//   runAnalysis     — 실제 실행 (전적 조회 → AI 호출 → RPC 저장)

import type { SupabaseClient } from "@supabase/supabase-js";
import { analyzePlaystyleWithGemini } from "@/lib/analysis/gemini";
import { analyzePlaystyleWithClaude } from "@/lib/analysis/claude";
import {
  aggregatePlaystyleInput,
  aggregateDeepPlaystyleInput,
  ANALYSIS_MATCH_SELECT,
  MIN_MATCHES_FOR_ANALYSIS,
  type StoredMatchRow,
} from "@/lib/analysis/aggregate";

const DAY_MS = 24 * 60 * 60 * 1000;

// 플랜별 재분석 주기
export const REANALYZE_INTERVAL_MS = {
  free: 7 * DAY_MS,
  premium: 3 * DAY_MS,
} as const;

export type AnalysisPlan = keyof typeof REANALYZE_INTERVAL_MS; // "free" | "premium"

// 스케줄러가 판단에 필요로 하는 최소한의 유저 정보 (profiles 행 일부)
export type SchedulerUser = {
  id: string;
  plan: AnalysisPlan;
  last_analyzed_at: string | null;
};

export type RunAnalysisResult = {
  analyzed: boolean;
  source?: "gemini" | "claude";
  // analyzed=false일 때 이유 (로그/디버깅용)
  reason?: "not_due" | "not_enough_matches" | "analysis_unavailable" | "save_failed";
};

// DB에서 온 plan 값이 이상해도 안전하게 free로 간주
export function normalizePlan(plan: string | null | undefined): AnalysisPlan {
  return plan === "premium" ? "premium" : "free";
}

// ─── 1) 재분석 필요 판단 — 순수 함수 ─────────────────────
// now를 파라미터로 받는 이유: 테스트에서 "8일 뒤"를 시뮬레이션할 수 있게.
// (내부에서 Date.now()를 부르면 테스트가 실제 시간에 묶여버립니다)
export function shouldReanalyze(
  user: Pick<SchedulerUser, "plan" | "last_analyzed_at">,
  now: number = Date.now(),
): boolean {
  // 최초 가입(분석 이력 없음) → 즉시 1회 분석
  if (!user.last_analyzed_at) {
    return true;
  }

  const lastAnalyzed = new Date(user.last_analyzed_at).getTime();

  // 파싱 불가능한 값이면 다시 분석하는 쪽이 안전
  if (Number.isNaN(lastAnalyzed)) {
    return true;
  }

  const interval = REANALYZE_INTERVAL_MS[user.plan];
  return now - lastAnalyzed >= interval;
}

// ─── 2) 분석 실행 ────────────────────────────────────────
// admin(service_role) 클라이언트를 주입받습니다 — 함수 안에서 직접 만들지 않아서
// 테스트에서 가짜 클라이언트를 넣을 수 있습니다 (의존성 주입).
export async function runAnalysis(
  user: SchedulerUser,
  admin: SupabaseClient,
): Promise<RunAnalysisResult> {
  // 호출부가 shouldReanalyze를 깜빡해도 여기서 한 번 더 방어
  if (!shouldReanalyze(user)) {
    return { analyzed: false, reason: "not_due" };
  }

  const { data: matches, error: matchesError } = await admin
    .from("valorant_matches")
    .select(ANALYSIS_MATCH_SELECT)
    .eq("user_id", user.id)
    .order("played_at", { ascending: false })
    .limit(10);

  if (matchesError || !matches || matches.length < MIN_MATCHES_FOR_ANALYSIS) {
    return { analyzed: false, reason: "not_enough_matches" };
  }

  const rows = matches as StoredMatchRow[];

  // 플랜 분기: free → Gemini(간단), premium → Claude(심층)
  const source: "gemini" | "claude" = user.plan === "premium" ? "claude" : "gemini";

  const claudeResult =
    source === "claude"
      ? await analyzePlaystyleWithClaude(aggregateDeepPlaystyleInput(rows))
      : null;

  const geminiResult =
    source === "gemini"
      ? await analyzePlaystyleWithGemini(aggregatePlaystyleInput(rows))
      : null;

  const analysis = claudeResult ?? geminiResult!;

  // Gemini 실패는 빈 태그로 돌아옴 — 저장하면 기존 분석을 지워버리므로 건너뜀.
  // Claude는 실패해도 더미(["분석 대기중"])가 오므로 저장됨 — 크레딧 없이도
  // 전체 플로우(호출 → 저장 → 매칭) 테스트가 가능해야 하기 때문 (의도된 차이).
  if (analysis.playstyle_tags.length === 0) {
    return { analyzed: false, reason: "analysis_unavailable" };
  }

  // synergy_notes는 Claude 전용 — Gemini 결과에는 없으므로 undefined 그대로 전달하면
  // RPC의 default null이 동작합니다 (021 migration 이후).
  const synergyNotes =
    claudeResult && "synergy_notes" in claudeResult
      ? (claudeResult.synergy_notes as string)
      : undefined;

  const { error: saveError } = await admin.rpc("save_playstyle_analysis", {
    p_user_id: user.id,
    p_playstyle_tags: analysis.playstyle_tags,
    p_aggression_score: analysis.aggression_score,
    p_role_preference: analysis.role_preference,
    p_analysis_source: source,
    ...(synergyNotes !== undefined && { p_synergy_notes: synergyNotes }),
  });

  if (saveError) {
    console.warn("[scheduler] analysis save failed:", saveError.message);
    return { analyzed: false, reason: "save_failed" };
  }

  return { analyzed: true, source };
}
