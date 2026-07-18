import "server-only";

// 프리미엄 플랜용 정성 분석 — Claude Sonnet
//
// 설계:
//   정량(aggression_score, tags, role)은 ruleBasedAnalyzer가 계산한 결과를 그대로 사용.
//   Claude는 아래를 생성합니다.
//     1) trend_summary      — 최근 폼/패턴 변화
//     2) situational_notes  — 맵별 조건부 성향 (사이드 데이터는 보류 → 맵만)
//     3) anomaly_notes      — 지표 간 모순·특이점
//     4) synergy_notes      — 파트너 궁합·시나리오 전술 (사람 읽는 용)
//     5) match_prefs        — 매칭 엔진이 쓰는 구조화 힌트 (역할/태그/공격성)
//
// 왜 match_prefs가 중요한가?
//   synergy_notes 문장만으로는 점수를 못 매깁니다.
//   preferred_roles 같은 고정 값이 있어야 "더 잘 맞는 후보"를 고를 수 있습니다.
//
// 토큰 통제: 짧은 JSON — 토큰 = 요금.

import type { RuleBasedAnalysis } from "@/lib/analysis/ruleBasedAnalyzer";
import {
  buildFallbackMatchPrefs,
  MATCH_PREF_TAGS,
  sanitizeMatchPrefs,
  type MatchPrefs,
} from "@/lib/matching/matchPrefs";

const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// 4축 노트 + match_prefs 여유
const MAX_TOKENS = 2200;
const REQUEST_TIMEOUT_MS = 30_000;

// 필드별 글자 상한 (sanitize + 프롬프트 양쪽에서 강제)
const FIELD_MAX_CHARS = 180;

export type QualitativeNotes = {
  trend_summary: string;
  situational_notes: string;
  anomaly_notes: string;
  synergy_notes: string;
};

export type ClaudePlaystyleAnalysis = RuleBasedAnalysis &
  QualitativeNotes & {
    match_prefs: MatchPrefs;
  };

function buildFallbackNotes(rule: RuleBasedAnalysis): QualitativeNotes {
  const topMap = rule.mapSummaries[0]?.map ?? "주요 맵";
  return {
    trend_summary: "AI 분석 준비 중입니다. 최근 전적 기준으로 폼 요약이 곧 제공됩니다.",
    situational_notes: `${topMap} 등 맵별 성향 분석이 준비 중입니다.`,
    anomaly_notes: "지표 특이점 분석이 준비 중입니다.",
    synergy_notes: "파트너 궁합 분석이 준비 중입니다.",
  };
}

const SYSTEM_PROMPT = [
  "너는 발로란트 전적 분석가다. 이미 계산된 정량 지표와 맵별 요약을 보고 정성 분석만 한다.",
  "정량값(aggression_score, tags, role)을 다시 계산하거나 바꾸지 마라.",
  "",
  "출력 규칙:",
  "- 응답은 오직 하나의 JSON 객체만. 인사·설명·마크다운 코드블록 금지.",
  "- 첫 글자는 { 이고 마지막 글자는 }.",
  '- 형식: {"trend_summary":"...","situational_notes":"...","anomaly_notes":"...","synergy_notes":"...","match_prefs":{"preferred_roles":["controller"],"preferred_tags":["신중형"],"avoid_tags":["엔트리프래거"],"preferred_aggression":"low"}}',
  "",
  "노트 필드 (각 한국어 2~3문장, 180자 이내):",
  "- trend_summary: 최근 폼/패턴 변화",
  "- situational_notes: 맵별 승률·KDA 차이로 본 조건부 성향 (사이드 없음)",
  "- anomaly_notes: 지표 간 모순·특이점",
  "- synergy_notes: 어떤 성향 파트너와 잘 맞는지 + 한 줄 전술",
  "",
  "match_prefs (매칭 엔진용, 배열 각 최대 3개):",
  '- preferred_roles: "duelist"|"initiator"|"controller"|"sentinel"|"flex" 만',
  `- preferred_tags / avoid_tags: 다음만 사용 → ${MATCH_PREF_TAGS.join(", ")}`,
  '- preferred_aggression: "low"|"mid"|"high"|null (원하는 파트너 공격성)',
  "- 본인과 상호보완되는 파트너를 고를 것 (둘 다 엔트리면 avoid 등)",
].join("\n");

function buildUserPrompt(rule: RuleBasedAnalysis): string {
  const s = rule.stats;
  const mapLines =
    rule.mapSummaries.length > 0
      ? rule.mapSummaries
          .slice(0, 5)
          .map(
            (m) =>
              `  - ${m.map}: ${m.matches}판, 승률 ${Math.round(m.winRate * 100)}%, KDA ${m.kda.toFixed(2)}`,
          )
          .join("\n")
      : "  - 데이터 없음";

  return [
    "규칙기반 정량 결과 (그대로 신뢰하고 해석만 해):",
    `- matchCount: ${s.matchCount}`,
    `- KDA: ${s.kda} (킬 ${s.avgKills} / 데스 ${s.avgDeaths} / 어시 ${s.avgAssists})`,
    `- winRate: ${Math.round(s.winRate * 100)}%`,
    `- ACS: ${s.acs}`,
    `- aggression_score: ${rule.aggression_score} (킬/캐리력 지표, 포지셔닝 아님)`,
    `- role_preference: ${rule.role_preference}`,
    `- playstyle_tags: ${rule.playstyle_tags.join(", ") || "없음"}`,
    "",
    "맵별 요약 (사이드 구분 없음):",
    mapLines,
  ].join("\n");
}

function sanitizeNotes(raw: unknown): QualitativeNotes | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const data = raw as Record<string, unknown>;
  const keys = [
    "trend_summary",
    "situational_notes",
    "anomaly_notes",
    "synergy_notes",
  ] as const;

  const out: Partial<QualitativeNotes> = {};

  for (const key of keys) {
    if (typeof data[key] !== "string") {
      return null;
    }
    const trimmed = data[key].trim().slice(0, FIELD_MAX_CHARS);
    if (trimmed.length === 0) {
      return null;
    }
    out[key] = trimmed;
  }

  return out as QualitativeNotes;
}

function notesAndPrefsFromParsed(
  parsed: unknown,
  rule: RuleBasedAnalysis,
): Pick<ClaudePlaystyleAnalysis, keyof QualitativeNotes | "match_prefs"> {
  const notes = sanitizeNotes(parsed);
  const data =
    typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  // Claude prefs가 깨져도 fallback으로 premium 차별화는 유지
  const prefs =
    sanitizeMatchPrefs(data?.match_prefs) ?? buildFallbackMatchPrefs(rule);

  return {
    ...(notes ?? buildFallbackNotes(rule)),
    match_prefs: prefs,
  };
}

function extractJsonText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    return trimmed;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}

// 규칙기반 정량 + Claude 정성. 실패 시 정량은 유지하고 정성/prefs는 fallback.
export async function analyzePlaystyleWithClaude(
  rule: RuleBasedAnalysis,
): Promise<ClaudePlaystyleAnalysis> {
  const fallback: ClaudePlaystyleAnalysis = {
    ...rule,
    ...buildFallbackNotes(rule),
    match_prefs: buildFallbackMatchPrefs(rule),
  };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[claude] Claude API 미사용 - 더미 노트 반환 (ANTHROPIC_API_KEY 미설정)");
    return fallback;
  }

  if (rule.stats.matchCount <= 0) {
    console.warn("[claude] Claude API 미사용 - 더미 노트 반환 (분석할 경기 없음)");
    return fallback;
  }

  try {
    const response = await fetch(CLAUDE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: buildUserPrompt(rule),
          },
        ],
        temperature: 0.4,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      // 402 = 크레딧 부족, 429 = rate limit, 401 = 키 오류 — 전부 더미
      console.warn(
        `[claude] Claude API 미사용 - 더미 노트 반환 (HTTP ${response.status})`,
      );
      return fallback;
    }

    const payload = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };

    const text = payload.content?.find((block) => block.type === "text")?.text;
    if (!text) {
      console.warn("[claude] Claude API 미사용 - 더미 노트 반환 (빈 응답)");
      return fallback;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonText(text));
    } catch {
      console.warn("[claude] Claude API 미사용 - 더미 노트 반환 (JSON 파싱 실패)");
      return fallback;
    }

    // 노트 검증 실패해도 prefs fallback으로 premium 매칭 차별은 유지
    const qualitative = notesAndPrefsFromParsed(parsed, rule);
    if (!sanitizeNotes(parsed)) {
      console.warn("[claude] 노트 검증 실패 — fallback 노트 + prefs 사용");
    }

    return { ...rule, ...qualitative };
  } catch (error) {
    console.warn(
      "[claude] Claude API 미사용 - 더미 노트 반환:",
      error instanceof Error ? error.message : "unknown error",
    );
    return fallback;
  }
}
