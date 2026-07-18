// 플레이스타일 재분석 — lazy refresh (큐 진입 시점 조건부 실행)
//
// 언제 쓰나?
//   - 유저가 매칭 큐에 들어갈 때 handleQueuePost → refreshAnalysisIfDue
//   - 크론/일괄 배치로 전체 유저를 도는 방식은 쓰지 않음
//
// 규칙 (텀 계산은 여기만 — 호출부에서 바꾸지 말 것):
//   - free    : 큐 입장마다 규칙기반 재계산 (LLM 없음 · 캐시 주기 없음)
//   - premium : 3일마다 규칙기반 + Claude 노트/match_prefs 재분석
//   - last_analyzed_at이 null(최초 가입)이면 즉시 1회 분석
//
// 왜 free는 매번인가?
//   규칙 분석은 서버 계산만이라 비용이 거의 없음.
//   전적이 바뀌면 바로 태그/점수가 반영되는 편이 자연스러움.
//   Claude(유료)만 API 비용이 있어서 3일 텀을 둠.
//
// 설계:
//   shouldReanalyze — 순수 함수. DB/네트워크 없이 입력만으로 판단 → 테스트 쉬움
//   runAnalysis     — 실제 실행 (전적 조회 → executePlanAnalysis → RPC 저장)

import type { SupabaseClient } from "@supabase/supabase-js";
import { executePlanAnalysis } from "@/lib/analysis/executePlanAnalysis";

const DAY_MS = 24 * 60 * 60 * 1000;

// premium만 주기 사용. free는 shouldReanalyze에서 항상 true.
export const REANALYZE_INTERVAL_MS = {
  free: 0,
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
  // free = 규칙만 → 큐 들어갈 때마다 최신 전적으로 다시 계산
  if (user.plan === "free") {
    return true;
  }

  // 최초 가입(분석 이력 없음) → 즉시 1회 분석
  if (!user.last_analyzed_at) {
    return true;
  }

  const lastAnalyzed = new Date(user.last_analyzed_at).getTime();

  // 파싱 불가능한 값이면 다시 분석하는 쪽이 안전
  if (Number.isNaN(lastAnalyzed)) {
    return true;
  }

  // premium만 3일 텀
  const interval = REANALYZE_INTERVAL_MS.premium;
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
