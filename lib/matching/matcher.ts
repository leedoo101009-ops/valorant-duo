// 듀오 매칭 궁합 계산 — 순수 로직 (API/DB 호출 없음)
//
// 왜 순수 함수인가?
//   입력(프로필 값)만으로 결과가 정해지므로 테스트가 쉽습니다.
//   DB 조회는 호출부(RPC/API Route)가 하고, 이 파일은 "비교 계산"만 담당합니다.
//   → 매칭 규칙을 바꿀 때 DB를 안 건드리고 이 파일만 수정하면 됩니다.
//
// 계층적 조건 (요구사항):
//   1) 하드 조건 — 무조건 만족 (티어 범위, 큐 활성 상태)
//   2) 소프트 조건 — AI 분석 기반 가산점 (공격성 상호보완, 역할 비겹침)
//      + premium이면 match_prefs 힌트로 후보 순위만 더 세밀하게 (거절 필터 아님)
//   3) 시간 완화 — 오래 기다릴수록 소프트 조건을 점점 무시하고 매칭을 성사시킴

import {
  scorePrefsAgainstPartner,
  type MatchPrefs,
} from "@/lib/matching/matchPrefs";

// ─── 상수 ────────────────────────────────────────────────

// 최근 접속(heartbeat) 판정 — 009_duo_matching.sql의 90초와 맞춤
export const PRESENCE_ACTIVE_THRESHOLD_SEC = 90;

// 티어 허용 범위 — 현재 티어 ±N 단계까지 매칭 허용
export const TIER_RANGE = 3;

// 기본 소프트 점수 가중치 (합 = 1) — free / prefs 없을 때
const WEIGHT_AGGRESSION = 0.5;
const WEIGHT_ROLE = 0.5;

// premium 힌트가 있을 때: 기본 궁합 65% + prefs 힌트 35%
// (힌트만으로 매칭을 막지 않고, 같은 후보 중 순위를 바꿈)
const WEIGHT_BASE_WITH_PREFS = 0.65;
const WEIGHT_PREFS = 0.35;

// 공격성 "상호보완"의 이상적인 차이.
// 0이면 둘 다 똑같은 성향(재미없음), 너무 크면 스타일 충돌.
// 0.4 정도 차이날 때 궁합이 가장 좋다고 가정합니다.
const IDEAL_AGGRESSION_DIFF = 0.4;

// 데이터(분석 결과)가 없을 때 쓰는 중립 점수.
// 0을 주면 분석 안 한 유저가 과하게 불리해지므로 0.5로 완충합니다.
const NEUTRAL_SUBSCORE = 0.5;

// 시간 기반 완화 구간 (초)
const SOFT_FULL_UNTIL_SEC = 30; // 0~30초: 소프트 100%
const SOFT_HALF_UNTIL_SEC = 60; // 30~60초: 소프트 50%, 이후: 0%

// ─── 타입 ────────────────────────────────────────────────

export type MatchProfile = {
  id: string;
  // 랭크 단계 인덱스 (예: Iron1=0 ... Radiant=N). null이면 티어 미설정 → 티어 조건 건너뜀.
  tier: number | null;
  aggressionScore: number | null; // 0~1
  rolePreference: string | null; // 예: "duelist"
  // 마지막 heartbeat 후 경과 초 — 하드 조건(활성) 판정용
  secondsSinceLastSeen: number;
  // premium일 때만 matchPrefs가 채워짐. free는 plan="free", prefs=null.
  plan: "free" | "premium";
  playstyleTags: string[];
  matchPrefs: MatchPrefs | null;
};

export type MatchResult = {
  user: MatchProfile;
  score: number; // 최종 점수 = synergyScore × 시간가중치 (랭킹용)
  synergyScore: number; // 원본 시너지 0~1 (시간 완화 반영 전)
};

// ─── 하드 조건 ───────────────────────────────────────────

function isActive(profile: MatchProfile): boolean {
  return profile.secondsSinceLastSeen <= PRESENCE_ACTIVE_THRESHOLD_SEC;
}

// 티어 범위 검사 — 둘 중 하나라도 tier가 null이면 제한할 수 없어 통과시킵니다.
function withinTierRange(a: MatchProfile, b: MatchProfile): boolean {
  if (a.tier == null || b.tier == null) {
    return true;
  }
  return Math.abs(a.tier - b.tier) <= TIER_RANGE;
}

// 하드 조건: 둘 다 활성 + 티어 범위 내. 하나라도 실패하면 매칭 불가.
export function passesHardConditions(a: MatchProfile, b: MatchProfile): boolean {
  return isActive(a) && isActive(b) && withinTierRange(a, b);
}

// ─── 소프트 조건 (시너지 점수) ───────────────────────────

// 공격성 상호보완 점수 (0~1). IDEAL_AGGRESSION_DIFF에 가까울수록 1.
function aggressionSynergy(a: MatchProfile, b: MatchProfile): number {
  if (a.aggressionScore == null || b.aggressionScore == null) {
    return NEUTRAL_SUBSCORE;
  }

  const diff = Math.abs(a.aggressionScore - b.aggressionScore);

  // 이상 차이(0.4)에서 멀어질수록 점수 하락하는 삼각형(tent) 함수.
  // diff=0.4 → 1.0, diff=0 또는 0.8 → 0.0
  const distanceFromIdeal = Math.abs(diff - IDEAL_AGGRESSION_DIFF);
  const score = 1 - distanceFromIdeal / IDEAL_AGGRESSION_DIFF;

  return Math.min(1, Math.max(0, score));
}

// 역할 비겹침 점수 (0~1). 역할이 다르면 1(상호보완), 같으면 0.
function roleSynergy(a: MatchProfile, b: MatchProfile): number {
  if (!a.rolePreference || !b.rolePreference) {
    return NEUTRAL_SUBSCORE;
  }

  // flex는 어느 역할과도 잘 맞는다고 보고 가산점
  if (a.rolePreference === "flex" || b.rolePreference === "flex") {
    return 1;
  }

  return a.rolePreference === b.rolePreference ? 0 : 1;
}

// premium 쪽 prefs ↔ 상대 실제 태그/역할 점수.
// 한쪽만 premium이어도 그 쪽 힌트를 씀 (후자 설계). 둘 다면 양방향 평균.
function premiumPrefsSynergy(a: MatchProfile, b: MatchProfile): number | null {
  const scores: number[] = [];

  if (a.plan === "premium" && a.matchPrefs) {
    scores.push(
      scorePrefsAgainstPartner(a.matchPrefs, {
        rolePreference: b.rolePreference,
        playstyleTags: b.playstyleTags,
        aggressionScore: b.aggressionScore,
      }),
    );
  }

  if (b.plan === "premium" && b.matchPrefs) {
    scores.push(
      scorePrefsAgainstPartner(b.matchPrefs, {
        rolePreference: a.rolePreference,
        playstyleTags: a.playstyleTags,
        aggressionScore: a.aggressionScore,
      }),
    );
  }

  if (scores.length === 0) {
    return null;
  }

  return scores.reduce((x, y) => x + y, 0) / scores.length;
}

// 두 유저의 플레이스타일 궁합 점수 (0~1). 순수 함수 — 테스트 대상.
export function calculateSynergyScore(a: MatchProfile, b: MatchProfile): number {
  const aggression = aggressionSynergy(a, b);
  const role = roleSynergy(a, b);
  const base = WEIGHT_AGGRESSION * aggression + WEIGHT_ROLE * role;

  const prefsScore = premiumPrefsSynergy(a, b);
  if (prefsScore == null) {
    // free↔free 또는 prefs 없음 → 기존과 동일
    return base;
  }

  return WEIGHT_BASE_WITH_PREFS * base + WEIGHT_PREFS * prefsScore;
}

// ─── 시간 기반 완화 ──────────────────────────────────────

// 대기 시간 → 소프트 조건 가중치 (1 → 0.5 → 0).
// 오래 기다린 유저는 궁합을 포기하더라도 매칭을 성사시키는 게 낫습니다.
export function softWeightForWaitTime(waitTimeSeconds: number): number {
  if (waitTimeSeconds < SOFT_FULL_UNTIL_SEC) {
    return 1;
  }
  if (waitTimeSeconds < SOFT_HALF_UNTIL_SEC) {
    return 0.5;
  }
  return 0;
}

// ─── 메인: 최적 상대 찾기 ────────────────────────────────

// currentUser에게 가장 궁합 좋은 상대를 queuedUsers에서 찾습니다.
// - 하드 조건을 통과한 후보만 대상
// - 소프트 점수 × 시간가중치로 랭킹
// - 동점(예: 60초 이후 전원 0점)이면 배열 순서(FIFO) 우선
// 없으면 null.
export function findBestMatch(
  currentUser: MatchProfile,
  queuedUsers: MatchProfile[],
  waitTimeSeconds: number,
): MatchResult | null {
  const softWeight = softWeightForWaitTime(waitTimeSeconds);

  let best: MatchResult | null = null;

  for (const candidate of queuedUsers) {
    // 자기 자신은 제외
    if (candidate.id === currentUser.id) {
      continue;
    }

    // 하드 조건 실패 → 시간이 아무리 지나도 매칭 불가
    if (!passesHardConditions(currentUser, candidate)) {
      continue;
    }

    const synergyScore = calculateSynergyScore(currentUser, candidate);
    const score = synergyScore * softWeight;

    // 첫 후보이거나 더 높은 점수면 교체.
    // 동점은 교체하지 않음 → 먼저 온 후보(FIFO) 유지 = 공정성
    if (best === null || score > best.score) {
      best = { user: candidate, score, synergyScore };
    }
  }

  return best;
}
