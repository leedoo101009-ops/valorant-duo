// 저장된 Valorant 전적(valorant_matches 행) → AI 분석 입력으로 집계
//
// 왜 분리했나?
//   /api/ai/analyze(수동 분석)와 lib/analysis/scheduler.ts(자동 재분석)가
//   같은 집계 로직을 쓰기 때문 — 한쪽만 고치면 두 분석 결과가 어긋납니다.

import type { PlaystyleInput } from "@/lib/analysis/gemini";
import type { AgentWinRate, DeepPlaystyleInput } from "@/lib/analysis/claude";

// valorant_matches에서 select하는 컬럼과 1:1
export type StoredMatchRow = {
  agent_name: string;
  kills: number;
  deaths: number;
  assists: number;
  won: boolean;
};

export const ANALYSIS_MATCH_SELECT = "agent_name, kills, deaths, assists, won";

// 분석에 필요한 최소 경기 수 — 1~2판으로는 스타일 판단이 무의미
export const MIN_MATCHES_FOR_ANALYSIS = 3;

type BaseStats = {
  kda: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  winRate: number;
  agentStats: Map<string, { matches: number; wins: number }>;
  matchCount: number;
};

function aggregateBase(matches: StoredMatchRow[]): BaseStats {
  const total = matches.length;

  let kills = 0;
  let deaths = 0;
  let assists = 0;
  let wins = 0;
  const agentStats = new Map<string, { matches: number; wins: number }>();

  for (const match of matches) {
    kills += match.kills;
    deaths += match.deaths;
    assists += match.assists;
    if (match.won) wins += 1;

    const agent = agentStats.get(match.agent_name) ?? { matches: 0, wins: 0 };
    agent.matches += 1;
    if (match.won) agent.wins += 1;
    agentStats.set(match.agent_name, agent);
  }

  return {
    // 데스 0이면 0으로 나누기가 되므로 최소 1로 보정
    kda: (kills + assists) / Math.max(deaths, 1),
    avgKills: kills / total,
    avgDeaths: deaths / total,
    avgAssists: assists / total,
    winRate: wins / total,
    agentStats,
    matchCount: total,
  };
}

// 무료(Gemini)용 — 간단 요약
export function aggregatePlaystyleInput(matches: StoredMatchRow[]): PlaystyleInput {
  const base = aggregateBase(matches);

  // 판수 많은 순 상위 3개 요원
  const topAgents = [...base.agentStats.entries()]
    .sort((a, b) => b[1].matches - a[1].matches)
    .slice(0, 3)
    .map(([agent]) => agent);

  return {
    kda: base.kda,
    avgKills: base.avgKills,
    avgDeaths: base.avgDeaths,
    avgAssists: base.avgAssists,
    headshotRate: null, // Riot 기본 전적 API에는 헤드샷 데이터가 없음
    winRate: base.winRate,
    topAgents,
    matchCount: base.matchCount,
  };
}

// 프리미엄(Claude)용 — 요원별 승률까지 포함한 심층 요약.
// 클러치/타임라인은 아직 DB에 없어 null/빈 배열 (Claude 프롬프트가 "데이터 없음" 처리)
export function aggregateDeepPlaystyleInput(
  matches: StoredMatchRow[],
): DeepPlaystyleInput {
  const base = aggregateBase(matches);

  const agentWinRates: AgentWinRate[] = [...base.agentStats.entries()]
    .sort((a, b) => b[1].matches - a[1].matches)
    .map(([agent, stats]) => ({
      agent,
      matches: stats.matches,
      winRate: stats.wins / stats.matches,
    }));

  return {
    kda: base.kda,
    avgKills: base.avgKills,
    avgDeaths: base.avgDeaths,
    avgAssists: base.avgAssists,
    headshotRate: null,
    winRate: base.winRate,
    agentWinRates,
    clutch: null,
    matchTimelines: [],
    matchCount: base.matchCount,
  };
}
