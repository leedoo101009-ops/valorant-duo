// 무료 플랜용 규칙기반 플레이스타일 분석 (LLM 호출 없음)
//
// 왜 규칙기반인가?
//   aggression_score / role_preference / playstyle_tags는 Riot 전적에서
//   수식으로 바로 계산 가능한 정량값입니다. Gemini 호출 비용·쿼터를 아끼고
//   결과가 재현 가능(같은 전적 → 같은 점수)해집니다.
//
// 임계값·가중치는 lib/constants/matching-thresholds.ts — 숫자 조정은 그쪽만.

import {
  AGGRESSION_WEIGHT_ACS,
  AGGRESSION_WEIGHT_KILL_SHARE,
  AGGRESSION_WEIGHT_SOLO,
  ACS_BASELINE_BY_ROLE,
  MAX_PLAYSTYLE_TAGS,
  ROLE_FLEX_MAX_SHARE,
  TAG_AGGRESSION_HIGH,
  TAG_AGGRESSION_LOW,
  TAG_ENTRY_MIN_AGGRESSION,
  TAG_KDA_EFFICIENT,
  TAG_WIN_RATE_CARRY,
  type AnalysisRole,
} from "@/lib/constants/matching-thresholds";

// ─── 요원 → 역할군 매핑 ──────────────────────────────────
const DUELISTS = new Set([
  "jett",
  "reyna",
  "raze",
  "phoenix",
  "yoru",
  "neon",
  "iso",
  "waylay",
]);
const INITIATORS = new Set([
  "sova",
  "breach",
  "skye",
  "kayo",
  "kay/o",
  "fade",
  "gekko",
  "tejo",
]);
const CONTROLLERS = new Set([
  "brimstone",
  "omen",
  "viper",
  "astra",
  "harbor",
  "clove",
]);
const SENTINELS = new Set([
  "sage",
  "cypher",
  "killjoy",
  "chamber",
  "deadlock",
  "vyse",
]);

export function guessRoleFromAgent(agent: string): AnalysisRole {
  const normalized = agent.trim().toLowerCase();
  if (DUELISTS.has(normalized)) return "duelist";
  if (INITIATORS.has(normalized)) return "initiator";
  if (CONTROLLERS.has(normalized)) return "controller";
  if (SENTINELS.has(normalized)) return "sentinel";
  return "flex";
}

// 규칙기반 입력 — valorant_matches 행에서 집계한 값
export type RuleBasedMatchRow = {
  agent_name: string;
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  rounds_played: number;
  won: boolean;
  map_name: string;
};

export type RuleBasedAnalysis = {
  playstyle_tags: string[];
  // ⚠️ 네이밍 주의:
  // aggression_score는 실제로는 "킬 지표력/캐리력"에 가깝습니다.
  // 진짜 공격적 포지셔닝(피크 빈도, 첫 데스, 엔트리 시도 등)을 재는 값이 아닙니다.
  // 매칭 소프트 조건·DB 컬럼명이 이미 aggression_score로 고정돼 있어 이름을 유지합니다.
  aggression_score: number;
  role_preference: AnalysisRole;
  // Claude 프롬프트/디버그에 쓰는 중간 집계 (DB에 저장하지 않음)
  stats: {
    matchCount: number;
    kda: number;
    avgKills: number;
    avgDeaths: number;
    avgAssists: number;
    winRate: number;
    acs: number;
    killShare: number;
    soloFactor: number;
    acsNorm: number;
  };
  // 맵별 요약 — situational_notes 입력용 (사이드 데이터는 보류, 맵만)
  mapSummaries: Array<{
    map: string;
    matches: number;
    winRate: number;
    kda: number;
  }>;
};

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function computeRolePreference(matches: RuleBasedMatchRow[]): AnalysisRole {
  const roleCounts = new Map<AnalysisRole, number>();
  let total = 0;

  for (const match of matches) {
    const role = guessRoleFromAgent(match.agent_name);
    // flex로 나온 Unknown 요원은 flex 버킷에 넣되, 비율 계산에 포함
    roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
    total += 1;
  }

  if (total === 0) {
    return "flex";
  }

  let bestRole: AnalysisRole = "flex";
  let bestCount = 0;

  for (const [role, count] of roleCounts) {
    if (count > bestCount) {
      bestCount = count;
      bestRole = role;
    }
  }

  const share = bestCount / total;
  if (share < ROLE_FLEX_MAX_SHARE) {
    return "flex";
  }

  return bestRole;
}

function buildPlaystyleTags(input: {
  aggressionScore: number;
  role: AnalysisRole;
  winRate: number;
  kda: number;
  avgKills: number;
  avgAssists: number;
}): string[] {
  // 우선순위: 특이성 높은 태그 먼저 (최대 MAX_PLAYSTYLE_TAGS개)
  // 1 엔트리프래거 → 2 캐리형 → 3 고효율 → 4 공격형/신중형 → 5 팀플레이형 → 6 밸런스형
  const tags: string[] = [];

  if (
    input.role === "duelist" &&
    input.aggressionScore >= TAG_ENTRY_MIN_AGGRESSION
  ) {
    tags.push("엔트리프래거");
  }

  if (input.winRate >= TAG_WIN_RATE_CARRY) {
    tags.push("캐리형");
  }

  if (input.kda >= TAG_KDA_EFFICIENT) {
    tags.push("고효율");
  }

  if (input.aggressionScore >= TAG_AGGRESSION_HIGH) {
    tags.push("공격형");
  } else if (input.aggressionScore <= TAG_AGGRESSION_LOW) {
    tags.push("신중형");
  }

  if (input.avgAssists >= input.avgKills) {
    tags.push("팀플레이형");
  }

  if (tags.length === 0) {
    tags.push("밸런스형");
  }

  return tags.slice(0, MAX_PLAYSTYLE_TAGS);
}

function buildMapSummaries(matches: RuleBasedMatchRow[]) {
  const byMap = new Map<
    string,
    { matches: number; wins: number; kills: number; deaths: number; assists: number }
  >();

  for (const match of matches) {
    const key = match.map_name || "Unknown";
    const row = byMap.get(key) ?? {
      matches: 0,
      wins: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
    };
    row.matches += 1;
    if (match.won) row.wins += 1;
    row.kills += match.kills;
    row.deaths += match.deaths;
    row.assists += match.assists;
    byMap.set(key, row);
  }

  return [...byMap.entries()]
    .map(([map, s]) => ({
      map,
      matches: s.matches,
      winRate: s.wins / s.matches,
      kda: (s.kills + s.assists) / Math.max(s.deaths, 1),
    }))
    .sort((a, b) => b.matches - a.matches);
}

// 전적 행 → 규칙기반 분석 결과 (순수 함수, API 호출 없음)
export function analyzePlaystyleRuleBased(
  matches: RuleBasedMatchRow[],
): RuleBasedAnalysis {
  const matchCount = matches.length;

  if (matchCount === 0) {
    return {
      playstyle_tags: [],
      aggression_score: 0,
      role_preference: "flex",
      stats: {
        matchCount: 0,
        kda: 0,
        avgKills: 0,
        avgDeaths: 0,
        avgAssists: 0,
        winRate: 0,
        acs: 0,
        killShare: 0.5,
        soloFactor: 0.5,
        acsNorm: 0,
      },
      mapSummaries: [],
    };
  }

  let kills = 0;
  let deaths = 0;
  let assists = 0;
  let score = 0;
  let rounds = 0;
  let wins = 0;

  for (const match of matches) {
    kills += match.kills;
    deaths += match.deaths;
    assists += match.assists;
    score += match.score;
    rounds += Math.max(match.rounds_played, 0);
    if (match.won) wins += 1;
  }

  const avgKills = kills / matchCount;
  const avgDeaths = deaths / matchCount;
  const avgAssists = assists / matchCount;
  const winRate = wins / matchCount;
  const kda = (kills + assists) / Math.max(deaths, 1);
  const acs = rounds > 0 ? score / rounds : 0;

  const killShare =
    avgKills + avgDeaths > 0 ? avgKills / (avgKills + avgDeaths) : 0.5;
  const soloFactor =
    avgKills + avgAssists > 0 ? avgKills / (avgKills + avgAssists) : 0.5;

  // role을 먼저 확정한 뒤 ACS 정규화 분모에 사용
  const rolePreference = computeRolePreference(matches);
  const baseline = ACS_BASELINE_BY_ROLE[rolePreference];
  const acsNorm = clamp01(acs / baseline);

  // aggression_score ≈ 킬 지표력/캐리력 (포지셔닝 공격성이 아님 — 위 타입 주석 참고)
  const aggressionScore = clamp01(
    AGGRESSION_WEIGHT_KILL_SHARE * killShare +
      AGGRESSION_WEIGHT_ACS * acsNorm +
      AGGRESSION_WEIGHT_SOLO * soloFactor,
  );

  const playstyleTags = buildPlaystyleTags({
    aggressionScore,
    role: rolePreference,
    winRate,
    kda,
    avgKills,
    avgAssists,
  });

  return {
    playstyle_tags: playstyleTags,
    aggression_score: Math.round(aggressionScore * 100) / 100,
    role_preference: rolePreference,
    stats: {
      matchCount,
      kda: Math.round(kda * 100) / 100,
      avgKills: Math.round(avgKills * 10) / 10,
      avgDeaths: Math.round(avgDeaths * 10) / 10,
      avgAssists: Math.round(avgAssists * 10) / 10,
      winRate: Math.round(winRate * 100) / 100,
      acs: Math.round(acs),
      killShare: Math.round(killShare * 100) / 100,
      soloFactor: Math.round(soloFactor * 100) / 100,
      acsNorm: Math.round(acsNorm * 100) / 100,
    },
    mapSummaries: buildMapSummaries(matches),
  };
}
