// 플레이스타일 규칙기반 분석 / 매칭에 쓰는 임계값·가중치
//
// 왜 파일로 분리하나?
//   실제 유저 데이터 분포를 본 뒤 숫자만 조정하면 되도록 —
//   계산 로직(ruleBasedAnalyzer.ts)을 건드리지 않고 이 파일만 수정합니다.

// ─── aggression_score 가중치 (합 = 1.0) ─────────────────
// Option A 확정: 킬지배력 0.4 + ACS 0.35 + 솔로팩터 0.25
export const AGGRESSION_WEIGHT_KILL_SHARE = 0.4;
export const AGGRESSION_WEIGHT_ACS = 0.35;
export const AGGRESSION_WEIGHT_SOLO = 0.25;

// role별 ACS 정규화 분모 — 컨트롤러/센티널은 구조적으로 ACS가 낮아
// 전 role 동일 기준(300)을 쓰면 듀얼리스트가 유리해집니다.
export const ACS_BASELINE_BY_ROLE = {
  duelist: 300,
  initiator: 260,
  controller: 220,
  sentinel: 220,
  flex: 260, // role 미확정 / 혼합 시 기본값
} as const;

export type AnalysisRole = keyof typeof ACS_BASELINE_BY_ROLE;

// ─── role_preference ─────────────────────────────────────
// 1위 role 비중이 이 값 미만이면 flex (여러 role을 고르게 플레이)
export const ROLE_FLEX_MAX_SHARE = 0.4;

// ─── playstyle_tags 임계값 ───────────────────────────────
export const TAG_AGGRESSION_HIGH = 0.65; // 이상 → "공격형"
export const TAG_AGGRESSION_LOW = 0.35; // 이하 → "신중형"
export const TAG_WIN_RATE_CARRY = 0.55; // 이상 → "캐리형"
export const TAG_KDA_EFFICIENT = 3.0; // 이상 → "고효율"
export const TAG_ENTRY_MIN_AGGRESSION = 0.5; // 엔트리프래거용 최소 aggression

// 태그 최대 개수
export const MAX_PLAYSTYLE_TAGS = 4;
