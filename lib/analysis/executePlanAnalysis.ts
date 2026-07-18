// 플랜별 분석 실행 — free=규칙기반만, premium=규칙기반 + Claude 정성
//
// scheduler(자동 재분석)와 /api/ai/analyze(수동)가 같은 분기 로직을 씁니다.
//
// Gemini 롤백 대비:
//   lib/analysis/gemini.ts 와 GEMINI_API_KEY 는 삭제하지 않음.
//   free 경로의 Gemini 호출은 아래 주석 블록으로 남겨 둠.

import type { SupabaseClient } from "@supabase/supabase-js";
import { parseUuid } from "@/lib/security/apiGuards";
import { analyzePlaystyleWithClaude } from "@/lib/analysis/claude";
import { analyzePlaystyleRuleBased } from "@/lib/analysis/ruleBasedAnalyzer";
import {
  ANALYSIS_MATCH_SELECT,
  MIN_MATCHES_FOR_ANALYSIS,
  toRuleBasedRows,
  type StoredMatchRow,
} from "@/lib/analysis/aggregate";
import { normalizePlan, type AnalysisPlan } from "@/lib/analysis/scheduler";
// import { analyzePlaystyleWithGemini } from "@/lib/analysis/gemini";
// import { aggregatePlaystyleInput } from "@/lib/analysis/aggregate";

export type AnalysisSource = "rule_based" | "claude";

export type ExecutePlanAnalysisResult = {
  ok: boolean;
  source?: AnalysisSource;
  matchCount?: number;
  analysis?: {
    playstyle_tags: string[];
    aggression_score: number;
    role_preference: string;
    analysis_source: AnalysisSource;
    trend_summary?: string | null;
    situational_notes?: string | null;
    anomaly_notes?: string | null;
    synergy_notes?: string | null;
    match_prefs?: Record<string, unknown> | null;
  };
  reason?: "not_enough_matches" | "analysis_unavailable" | "save_failed";
};

export async function executePlanAnalysis(
  userId: string,
  plan: AnalysisPlan | string | null | undefined,
  admin: SupabaseClient,
): Promise<ExecutePlanAnalysisResult> {
  const validUserId = parseUuid(userId);
  if (!validUserId) {
    return { ok: false, reason: "analysis_unavailable" };
  }

  const normalizedPlan = normalizePlan(plan);

  const { data: matches, error: matchesError } = await admin
    .from("valorant_matches")
    .select(ANALYSIS_MATCH_SELECT)
    .eq("user_id", validUserId)
    .order("played_at", { ascending: false })
    .limit(10);

  if (matchesError || !matches || matches.length < MIN_MATCHES_FOR_ANALYSIS) {
    return { ok: false, reason: "not_enough_matches" };
  }

  const rows = toRuleBasedRows(matches as StoredMatchRow[]);
  const rule = analyzePlaystyleRuleBased(rows);

  if (rule.playstyle_tags.length === 0) {
    return { ok: false, reason: "analysis_unavailable" };
  }

  if (normalizedPlan === "premium") {
    const analysis = await analyzePlaystyleWithClaude(rule);

    const { error: saveError } = await admin.rpc("save_playstyle_analysis", {
      p_user_id: validUserId,
      p_playstyle_tags: analysis.playstyle_tags,
      p_aggression_score: analysis.aggression_score,
      p_role_preference: analysis.role_preference,
      p_analysis_source: "claude",
      p_trend_summary: analysis.trend_summary,
      p_situational_notes: analysis.situational_notes,
      p_anomaly_notes: analysis.anomaly_notes,
      p_synergy_notes: analysis.synergy_notes,
      // 매칭 엔진이 읽는 구조화 힌트 (문장 synergy_notes와 별개)
      p_match_prefs: analysis.match_prefs,
    });

    if (saveError) {
      console.warn("[executePlanAnalysis] claude save failed:", saveError.message);
      return { ok: false, reason: "save_failed" };
    }

    return {
      ok: true,
      source: "claude",
      matchCount: rows.length,
      analysis: {
        playstyle_tags: analysis.playstyle_tags,
        aggression_score: analysis.aggression_score,
        role_preference: analysis.role_preference,
        analysis_source: "claude",
        trend_summary: analysis.trend_summary,
        situational_notes: analysis.situational_notes,
        anomaly_notes: analysis.anomaly_notes,
        synergy_notes: analysis.synergy_notes,
        match_prefs: analysis.match_prefs,
      },
    };
  }

  // ── free: 규칙기반만 (Gemini 호출 제거) ─────────────────
  // free는 Claude/match_prefs 없음 → 매칭은 aggression+role만.
  // [롤백용] Gemini 경로를 다시 쓰려면:
  //   1) gemini.ts 의 analyzePlaystyleWithGemini import 복구
  //   2) aggregate에 Gemini용 PlaystyleInput 집계 함수를 git에서 복원
  //   3) 아래 rule_based 저장 대신 Gemini 결과 + p_analysis_source: "gemini" 사용
  // GEMINI_API_KEY / gemini.ts 파일은 삭제하지 말 것.

  const { error: saveError } = await admin.rpc("save_playstyle_analysis", {
    p_user_id: validUserId,
    p_playstyle_tags: rule.playstyle_tags,
    p_aggression_score: rule.aggression_score,
    p_role_preference: rule.role_preference,
    p_analysis_source: "rule_based",
    // 예전에 premium이었다가 내려온 경우 prefs 잔여분 제거
    p_match_prefs: null,
  });

  if (saveError) {
    console.warn("[executePlanAnalysis] rule_based save failed:", saveError.message);
    return { ok: false, reason: "save_failed" };
  }

  return {
    ok: true,
    source: "rule_based",
    matchCount: rows.length,
    analysis: {
      playstyle_tags: rule.playstyle_tags,
      aggression_score: rule.aggression_score,
      role_preference: rule.role_preference,
      analysis_source: "rule_based",
      trend_summary: null,
      situational_notes: null,
      anomaly_notes: null,
      synergy_notes: null,
      match_prefs: null,
    },
  };
}
