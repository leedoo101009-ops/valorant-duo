// premium 매칭용 "원하는 파트너" 힌트
//
// 왜 문장(synergy_notes)이 아니라 구조화 JSON인가?
//   매칭 점수는 숫자 비교로만 계산합니다.
//   "신중한 컨트롤러와 잘 맞음" 같은 문장은 컴퓨터가 정확히 비교하기 어렵고,
//   preferred_roles / preferred_tags 처럼 정해진 값이면 후보와 바로 대조할 수 있습니다.
//
// 누가 쓰나?
//   - Claude(또는 fallback)가 premium 분석 때 저장
//   - free는 null → 매칭은 기존 aggression+role만 사용
//   - premium ↔ free 매칭이어도, premium 쪽 prefs로 후보 순위를 더 세밀하게 매김

import type { AnalysisRole } from "@/lib/constants/matching-thresholds";
import type { RuleBasedAnalysis } from "@/lib/analysis/ruleBasedAnalyzer";

export const MATCH_PREF_ROLES = [
  "duelist",
  "initiator",
  "controller",
  "sentinel",
  "flex",
] as const;

// ruleBasedAnalyzer가 실제로 붙이는 태그와 동일해야 대조가 됩니다
export const MATCH_PREF_TAGS = [
  "엔트리프래거",
  "캐리형",
  "고효율",
  "공격형",
  "신중형",
  "팀플레이형",
  "밸런스형",
] as const;

export const MATCH_PREF_AGGRESSION = ["low", "mid", "high"] as const;

export type MatchPrefAggression = (typeof MATCH_PREF_AGGRESSION)[number];

export type MatchPrefs = {
  preferred_roles: AnalysisRole[];
  preferred_tags: string[];
  avoid_tags: string[];
  preferred_aggression: MatchPrefAggression | null;
};

const ROLE_SET = new Set<string>(MATCH_PREF_ROLES);
const TAG_SET = new Set<string>(MATCH_PREF_TAGS);
const AGG_SET = new Set<string>(MATCH_PREF_AGGRESSION);

const MAX_LIST = 3;
const NEUTRAL = 0.5;

function asRoleList(raw: unknown): AnalysisRole[] {
  if (!Array.isArray(raw)) return [];
  const out: AnalysisRole[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const v = item.trim().toLowerCase();
    if (!ROLE_SET.has(v)) continue;
    if (!out.includes(v as AnalysisRole)) out.push(v as AnalysisRole);
    if (out.length >= MAX_LIST) break;
  }
  return out;
}

function asTagList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const v = item.trim();
    if (!TAG_SET.has(v)) continue;
    if (!out.includes(v)) out.push(v);
    if (out.length >= MAX_LIST) break;
  }
  return out;
}

// Claude/DB에서 온 JSON을 안전한 MatchPrefs로 정리. 실패하면 null.
export function sanitizeMatchPrefs(raw: unknown): MatchPrefs | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const data = raw as Record<string, unknown>;
  const preferred_roles = asRoleList(data.preferred_roles);
  const preferred_tags = asTagList(data.preferred_tags);
  const avoid_tags = asTagList(data.avoid_tags);

  let preferred_aggression: MatchPrefAggression | null = null;
  if (typeof data.preferred_aggression === "string") {
    const a = data.preferred_aggression.trim().toLowerCase();
    if (AGG_SET.has(a)) {
      preferred_aggression = a as MatchPrefAggression;
    }
  } else if (data.preferred_aggression === null) {
    preferred_aggression = null;
  }

  // 전부 비어 있으면 매칭에 쓸 정보가 없음
  if (
    preferred_roles.length === 0 &&
    preferred_tags.length === 0 &&
    avoid_tags.length === 0 &&
    preferred_aggression == null
  ) {
    return null;
  }

  return {
    preferred_roles,
    preferred_tags,
    avoid_tags,
    preferred_aggression,
  };
}

// Claude 실패 시에도 premium 차별화가 남도록, 정량 결과로 힌트를 만듭니다.
// (상호보완: 공격형 → 신중형 파트너 선호 등)
export function buildFallbackMatchPrefs(rule: RuleBasedAnalysis): MatchPrefs {
  const role = rule.role_preference;
  const complementary: Record<AnalysisRole, AnalysisRole[]> = {
    duelist: ["controller", "sentinel", "initiator"],
    initiator: ["duelist", "controller"],
    controller: ["duelist", "initiator"],
    sentinel: ["duelist", "initiator"],
    flex: ["duelist", "controller", "sentinel"],
  };

  const tags = rule.playstyle_tags;
  const preferred_tags: string[] = [];
  const avoid_tags: string[] = [];

  if (tags.includes("공격형") || tags.includes("엔트리프래거")) {
    preferred_tags.push("신중형", "팀플레이형");
    avoid_tags.push("엔트리프래거");
  } else if (tags.includes("신중형")) {
    preferred_tags.push("공격형", "캐리형");
  } else {
    preferred_tags.push("밸런스형", "팀플레이형");
  }

  let preferred_aggression: MatchPrefAggression = "mid";
  if (rule.aggression_score >= 0.65) {
    preferred_aggression = "low";
  } else if (rule.aggression_score <= 0.35) {
    preferred_aggression = "high";
  }

  return {
    preferred_roles: complementary[role] ?? ["flex"],
    preferred_tags: preferred_tags.slice(0, MAX_LIST),
    avoid_tags: avoid_tags.slice(0, MAX_LIST),
    preferred_aggression,
  };
}

// seeker의 prefs가 partner 프로필과 얼마나 맞는지 (0~1)
export function scorePrefsAgainstPartner(
  prefs: MatchPrefs,
  partner: {
    rolePreference: string | null;
    playstyleTags: string[];
    aggressionScore: number | null;
  },
): number {
  const parts: number[] = [];

  if (prefs.preferred_roles.length > 0) {
    const role = partner.rolePreference;
    if (!role) {
      parts.push(NEUTRAL);
    } else if (prefs.preferred_roles.includes(role as AnalysisRole)) {
      parts.push(1);
    } else if (role === "flex") {
      parts.push(0.85);
    } else {
      parts.push(0.15);
    }
  }

  if (prefs.preferred_tags.length > 0) {
    const partnerTags = new Set(partner.playstyleTags);
    const hits = prefs.preferred_tags.filter((t) => partnerTags.has(t)).length;
    parts.push(hits / prefs.preferred_tags.length);
  }

  if (prefs.avoid_tags.length > 0) {
    const partnerTags = new Set(partner.playstyleTags);
    const hits = prefs.avoid_tags.filter((t) => partnerTags.has(t)).length;
    // avoid에 많이 걸리면 점수↓
    parts.push(1 - hits / prefs.avoid_tags.length);
  }

  if (prefs.preferred_aggression != null) {
    const agg = partner.aggressionScore;
    if (agg == null) {
      parts.push(NEUTRAL);
    } else if (prefs.preferred_aggression === "low") {
      // 낮을수록 좋음 (0 → 1, 1 → 0)
      parts.push(Math.min(1, Math.max(0, 1 - agg)));
    } else if (prefs.preferred_aggression === "high") {
      parts.push(Math.min(1, Math.max(0, agg)));
    } else {
      // mid: 0.5에 가까울수록 1
      parts.push(Math.min(1, Math.max(0, 1 - Math.abs(agg - 0.5) * 2)));
    }
  }

  if (parts.length === 0) {
    return NEUTRAL;
  }

  return parts.reduce((a, b) => a + b, 0) / parts.length;
}
