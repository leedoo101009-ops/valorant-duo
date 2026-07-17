// 플레이스타일 재분석 스케줄러
//
// 언제 쓰나?
//   - 유저가 매칭 큐에 들어올 때 (큐 join API에서 호출)
//   - 또는 크론잡에서 온라인 유저를 돌면서 호출
//
// 규칙:
//   - free    : 7일(주 1회) 지났으면 규칙기반 재분석 (LLM 없음)
//   - premium : 3일 지났으면 규칙기반 + Claude 정성 재분석
//   - last_analyzed_at이 null(최초 가입)이면 즉시 1회 분석
//
// 설계:
//   shouldReanalyze — 순수 함수. DB/네트워크 없이 입력만으로 판단 → 테스트 쉬움
//   runAnalysis     — 실제 실행 (전적 조회 → executePlanAnalysis → RPC 저장)

import type { SupabaseClient } from "@supabase/supabase-js";
import { executePlanAnalysis } from "@/lib/analysis/executePlanAnalysis";

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
  source?: "rule_based" | "claude";
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

  const result = await executePlanAnalysis(user.id, user.plan, admin);

  if (!result.ok) {
    return { analyzed: false, reason: result.reason };
  }

  return { analyzed: true, source: result.source };
}
