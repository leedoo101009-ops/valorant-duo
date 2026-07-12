import "server-only";

// 무료 플랜 유저용 플레이스타일 분석 — Google Gemini 2.5 Flash (무료 티어)
//
// 왜 서버 전용인가?
//   GEMINI_API_KEY는 process.env로만 읽습니다 (NEXT_PUBLIC_ 아님).
//   → 이 파일은 API Route(서버)에서만 import 해야 합니다.
//   브라우저에 키가 노출되면 남이 내 무료 쿼터를 다 써버리거나
//   유료 전환 시 요금 폭탄이 날 수 있습니다.
//
// 왜 SDK 대신 fetch인가?
//   lib/riot/valorant.ts와 동일한 패턴 — 의존성 추가 없이 REST API 직접 호출.

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// 무료 티어가 느릴 수 있어 여유 있게, 그래도 Vercel 함수 타임아웃보다는 짧게
const REQUEST_TIMEOUT_MS = 20_000;

// AI 분석에 넣을 전적 요약 — /api/valorant/sync가 저장한 데이터를 집계해서 전달
export type PlaystyleInput = {
  kda: number; // (킬+어시스트)/데스
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  headshotRate: number | null; // 0~1, 데이터 없으면 null
  winRate: number; // 0~1
  topAgents: string[]; // 판수 많은 순 (예: ["Jett", "Reyna"])
  matchCount: number; // 집계에 사용한 경기 수
};

export type PlaystyleAnalysis = {
  playstyle_tags: string[];
  aggression_score: number; // 0~1
  role_preference: string;
};

// API 실패(한도 초과 등)나 파싱 실패 시 반환하는 안전한 기본값.
// 에러를 던지지 않아야 무료 유저 화면이 "분석 실패"로 죽지 않고
// 그냥 "아직 분석 없음" 상태로 자연스럽게 넘어갑니다.
export const EMPTY_PLAYSTYLE_ANALYSIS: PlaystyleAnalysis = {
  playstyle_tags: [],
  aggression_score: 0,
  role_preference: "",
};

// Gemini에게 "이 스키마의 JSON만 응답해"라고 강제하는 설정.
// 프롬프트로만 부탁하면 가끔 ```json 코드블록이나 잡담이 섞여 나오는데,
// responseSchema를 주면 모델이 스키마에 맞는 순수 JSON만 출력합니다.
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    playstyle_tags: {
      type: "ARRAY",
      items: { type: "STRING" },
    },
    aggression_score: { type: "NUMBER" },
    role_preference: { type: "STRING" },
  },
  required: ["playstyle_tags", "aggression_score", "role_preference"],
} as const;

function buildPrompt(input: PlaystyleInput): string {
  // 숫자를 문자열로 정리해서 넣기만 — 유저 입력이 아니라 우리 서버가 만든
  // 집계값이므로 프롬프트 인젝션 걱정은 없습니다.
  const headshot =
    input.headshotRate == null
      ? "데이터 없음"
      : `${Math.round(input.headshotRate * 100)}%`;

  return [
    "너는 발로란트 전적 분석가야. 아래 유저의 최근 전적 요약을 보고 플레이스타일을 분석해.",
    "",
    `- 분석 경기 수: ${input.matchCount}`,
    `- KDA: ${input.kda.toFixed(2)} (평균 킬 ${input.avgKills.toFixed(1)} / 데스 ${input.avgDeaths.toFixed(1)} / 어시스트 ${input.avgAssists.toFixed(1)})`,
    `- 헤드샷률: ${headshot}`,
    `- 승률: ${Math.round(input.winRate * 100)}%`,
    `- 주 요원: ${input.topAgents.length > 0 ? input.topAgents.join(", ") : "데이터 없음"}`,
    "",
    "다음 JSON 형식으로만 응답해. 설명이나 다른 텍스트는 절대 넣지 마.",
    '- playstyle_tags: 한국어 태그 2~4개 (예: ["공격형", "엔트리"])',
    "- aggression_score: 0~1 사이 숫자 (킬 비중·요원 성향 기반 공격성)",
    '- role_preference: 주 요원 기반 선호 역할군 하나 ("duelist" | "initiator" | "controller" | "sentinel" | "flex")',
  ].join("\n");
}

// 값이 깨져 있어도 화면/DB가 안전하도록 범위를 보정합니다.
function sanitizeAnalysis(raw: unknown): PlaystyleAnalysis | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const data = raw as Record<string, unknown>;

  const tags = Array.isArray(data.playstyle_tags)
    ? data.playstyle_tags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0 && tag.length <= 20)
        .slice(0, 4)
    : null;

  const score =
    typeof data.aggression_score === "number" &&
    Number.isFinite(data.aggression_score)
      ? Math.min(1, Math.max(0, data.aggression_score))
      : null;

  const role =
    typeof data.role_preference === "string"
      ? data.role_preference.trim().toLowerCase().slice(0, 20)
      : null;

  if (tags === null || score === null || role === null) {
    return null;
  }

  return {
    playstyle_tags: tags,
    aggression_score: score,
    role_preference: role,
  };
}

// 전적 요약 → Gemini 분석 결과.
// 실패해도 throw 하지 않고 EMPTY_PLAYSTYLE_ANALYSIS를 반환합니다 (요구사항).
export async function analyzePlaystyleWithGemini(
  input: PlaystyleInput,
): Promise<PlaystyleAnalysis> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // 키 미설정 = 설정 문제이지 유저 잘못이 아니므로 조용히 기본값
    console.warn("[gemini] GEMINI_API_KEY not set — skipping analysis");
    return EMPTY_PLAYSTYLE_ANALYSIS;
  }

  // 경기 수가 너무 적으면 분석 의미가 없음 — API 호출(쿼터) 아끼기
  if (input.matchCount <= 0) {
    return EMPTY_PLAYSTYLE_ANALYSIS;
  }

  try {
    const response = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // 키는 URL이 아니라 헤더로 — URL에 넣으면 로그에 남을 수 있음
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: buildPrompt(input) }],
          },
        ],
        generationConfig: {
          // JSON 모드: 순수 JSON만 응답하게 강제
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.4,
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      // 429 = 무료 티어 한도 초과가 대표적 — 던지지 않고 기본값 폴백
      console.warn(`[gemini] API error: HTTP ${response.status}`);
      return EMPTY_PLAYSTYLE_ANALYSIS;
    }

    const payload = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.warn("[gemini] empty response");
      return EMPTY_PLAYSTYLE_ANALYSIS;
    }

    // JSON 모드라도 파싱 실패 가능성에 대비 (요구사항: try-catch)
    const parsed = sanitizeAnalysis(JSON.parse(text));
    if (!parsed) {
      console.warn("[gemini] response failed validation");
      return EMPTY_PLAYSTYLE_ANALYSIS;
    }

    return parsed;
  } catch (error) {
    // 네트워크 오류, 타임아웃, JSON.parse 실패 전부 여기로
    console.warn(
      "[gemini] analysis failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return EMPTY_PLAYSTYLE_ANALYSIS;
  }
}
