import "server-only";

// 프리미엄 플랜용 정성 분석 — Claude Sonnet
//
// 설계:
//   정량(aggression_score, tags, role)은 ruleBasedAnalyzer가 계산한 결과를 그대로 사용.
//   Claude는 아래 4축만 생성합니다.
//     1) trend_summary      — 최근 폼/패턴 변화
//     2) situational_notes  — 맵별 조건부 성향 (사이드 데이터는 보류 → 맵만)
//     3) anomaly_notes      — 지표 간 모순·특이점
//     4) synergy_notes      — 파트너 궁합·시나리오 전술
//
// 토큰 통제:
//   결과가 짧고 구조화된 JSON이면 충분 — 토큰 = 요금이므로 낭비 방지.
//   필드가 4개로 늘어 MAX_TOKENS를 500 → 2000으로 재산정.
//   (필드당 2~3문장 × 4 ≈ 출력 ~400~800, 여유 포함 상한 2000)
//
// 예상 토큰 (대략):
//   입력 system+user  ~800~1,200
//   출력 실제         ~400~800
//   1회 총합          ~1,200~2,000 (이전 정량+정성 혼합보다 출력만 늘림)

import type { RuleBasedAnalysis } from "@/lib/analysis/ruleBasedAnalyzer";

const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// 필드 4개 × 2~3문장 + JSON 래퍼 여유.
// 500은 한 필드만 길게 써도 잘릴 수 있어 2000으로 상향.
const MAX_TOKENS = 2000;
const REQUEST_TIMEOUT_MS = 30_000;

// 필드별 글자 상한 (sanitize + 프롬프트 양쪽에서 강제)
const FIELD_MAX_CHARS = 180;

export type QualitativeNotes = {
  trend_summary: string;
  situational_notes: string;
  anomaly_notes: string;
  synergy_notes: string;
};

export type ClaudePlaystyleAnalysis = RuleBasedAnalysis & QualitativeNotes;

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
  '- 형식: {"trend_summary":"...","situational_notes":"...","anomaly_notes":"...","synergy_notes":"..."}',
  "",
  "필드 규칙 (각 필드는 한국어 2~3문장, 180자 이내, 불필요한 수식어 금지):",
  "- trend_summary: 최근 폼/패턴 변화 (예: 승률·KDA 흐름, 공격성 변화)",
  "- situational_notes: 맵별 승률·KDA 차이로 본 조건부 성향 (사이드 데이터 없음 — 맵만)",
  "- anomaly_notes: 지표 간 모순·특이점 (예: 공격성 높은데 승률 낮음)",
  "- synergy_notes: 어떤 성향 파트너와 잘 맞는지 + 한 줄 전술 시나리오",
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

// 규칙기반 정량 + Claude 정성. 실패 시 정량은 유지하고 정성만 더미.
export async function analyzePlaystyleWithClaude(
  rule: RuleBasedAnalysis,
): Promise<ClaudePlaystyleAnalysis> {
  const fallback = { ...rule, ...buildFallbackNotes(rule) };

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

    const notes = sanitizeNotes(parsed);
    if (!notes) {
      console.warn("[claude] Claude API 미사용 - 더미 노트 반환 (응답 검증 실패)");
      return fallback;
    }

    return { ...rule, ...notes };
  } catch (error) {
    console.warn(
      "[claude] Claude API 미사용 - 더미 노트 반환:",
      error instanceof Error ? error.message : "unknown error",
    );
    return fallback;
  }
}
