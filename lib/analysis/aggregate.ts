// 저장된 Valorant 전적(valorant_matches 행) → 분석 입력으로 집계
//
// 왜 분리했나?
//   /api/ai/analyze(수동)와 scheduler(자동)가 같은 집계를 쓰기 때문.

import type { RuleBasedMatchRow } from "@/lib/analysis/ruleBasedAnalyzer";

// valorant_matches에서 select하는 컬럼 — 규칙기반 ACS·맵 요약에 필요
export type StoredMatchRow = {
  agent_name: string;
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  rounds_played: number;
  won: boolean;
  map_name: string;
};

export const ANALYSIS_MATCH_SELECT =
  "agent_name, kills, deaths, assists, score, rounds_played, won, map_name";

// 분석에 필요한 최소 경기 수 — 1~2판으로는 스타일 판단이 무의미
export const MIN_MATCHES_FOR_ANALYSIS = 3;

export function toRuleBasedRows(matches: StoredMatchRow[]): RuleBasedMatchRow[] {
  return matches.map((m) => ({
    agent_name: m.agent_name,
    kills: m.kills,
    deaths: m.deaths,
    assists: m.assists,
    score: m.score,
    rounds_played: m.rounds_played,
    won: m.won,
    map_name: m.map_name,
  }));
}
