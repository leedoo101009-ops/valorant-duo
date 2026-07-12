import "server-only";

// 프리미엄 플랜 유저용 심층 플레이스타일 분석 — Claude Sonnet
//
// 왜 서버 전용인가? (gemini.ts와 동일)
//   ANTHROPIC_API_KEY는 process.env로만 읽습니다 (NEXT_PUBLIC_ 아님).
//   → API Route(서버)에서만 import 해야 합니다.
//   Claude는 종량제 유료라서, 키가 브라우저에 노출되면 그대로 요금 폭탄입니다.
//
// 왜 SDK 대신 fetch인가?
//   lib/riot/valorant.ts, lib/analysis/gemini.ts와 동일한 패턴 —
//   의존성 추가 없이 REST API(Messages API) 직접 호출.

const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01"; // Anthropic API 필수 헤더 (버전 고정)

// 결과가 짧고 구조화된 JSON이라 500 토큰이면 충분 — 토큰 = 요금이므로 낭비 방지
const MAX_TOKENS = 500;
const REQUEST_TIMEOUT_MS = 30_000;

// ─── 입력 타입 ───────────────────────────────────────────
// 무료(Gemini)보다 풍부한 데이터: 요원별 승률, 클러치, 타임라인 요약까지

export type AgentWinRate = {
  agent: string; // 예: "Jett"
  matches: number;
  winRate: number; // 0~1
};

export type ClutchStats = {
  attempts: number; // 1vX 상황 횟수
  wins: number; // 그중 이긴 횟수
};

export type DeepPlaystyleInput = {
  kda: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  headshotRate: number | null; // 0~1, 데이터 없으면 null
  winRate: number; // 0~1
  agentWinRates: AgentWinRate[]; // 요원별 승률 (판수 많은 순)
  clutch: ClutchStats | null; // 클러치 데이터 없으면 null
  matchTimelines: string[]; // 매치별 타임라인 한 줄 요약 (예: "초반 엔트리 2킬 → 중반 사망")
  matchCount: number;
};

export type DeepPlaystyleAnalysis = {
  playstyle_tags: string[];
  aggression_score: number; // 0~1
  role_preference: string;
  synergy_notes: string; // 어떤 성향의 파트너와 잘 맞는지 한 줄
};

// ─── 폴백(더미) 분석 ─────────────────────────────────────
// Claude 크레딧이 없어도 프리미엄 플로우(호출 → 저장 → 매칭)를
// 끊김 없이 개발/테스트할 수 있도록, 실패 시 입력 데이터 기반 근사값을 반환합니다.

function buildFallbackAnalysis(input: DeepPlaystyleInput): DeepPlaystyleAnalysis {
  // 공격성 근사값: 평균 킬 비중(킬이 많을수록 공격적) + 헤드샷률 보정
  // 정확한 분석이 아니라 "그럴듯한 자리 채우기"가 목적입니다.
  const killShare =
    input.avgKills + input.avgDeaths > 0
      ? input.avgKills / (input.avgKills + input.avgDeaths)
      : 0.5;

  const headshotBonus = (input.headshotRate ?? 0.15) * 0.5;
  const approxAggression = Math.min(1, Math.max(0, killShare * 0.8 + headshotBonus));

  // 판수 1위 요원으로 역할군 추정 (모르면 flex)
  const topAgent = input.agentWinRates[0]?.agent ?? "";
  const rolePreference = guessRoleFromAgent(topAgent);

  return {
    playstyle_tags: ["분석 대기중"],
    // 소수 둘째 자리로 반올림 — 더미 값임이 티나게 과한 정밀도 제거
    aggression_score: Math.round(approxAggression * 100) / 100,
    role_preference: rolePreference,
    synergy_notes: "AI 분석 준비 중입니다",
  };
}

// 대표 요원 → 역할군 (더미 분석 전용의 아주 단순한 매핑)
function guessRoleFromAgent(agent: string): string {
  const normalized = agent.trim().toLowerCase();

  const duelists = ["jett", "reyna", "raze", "phoenix", "yoru", "neon", "iso", "waylay"];
  const initiators = ["sova", "breach", "skye", "kayo", "kay/o", "fade", "gekko", "tejo"];
  const controllers = ["brimstone", "omen", "viper", "astra", "harbor", "clove"];
  const sentinels = ["sage", "cypher", "killjoy", "chamber", "deadlock", "vyse"];

  if (duelists.includes(normalized)) return "duelist";
  if (initiators.includes(normalized)) return "initiator";
  if (controllers.includes(normalized)) return "controller";
  if (sentinels.includes(normalized)) return "sentinel";
  return "flex";
}

// ─── 프롬프트 ────────────────────────────────────────────

const SYSTEM_PROMPT = [
  "너는 발로란트 전적 데이터를 분석하는 전문 분석가야.",
  "주어진 전적 요약을 바탕으로 플레이스타일을 심층 분석해.",
  "",
  "출력 규칙 (반드시 지켜):",
  "- 응답은 오직 하나의 JSON 객체만. 인사말, 설명, 마크다운 코드블록(```) 절대 금지.",
  "- 첫 글자는 { 이고 마지막 글자는 } 여야 해.",
  "- 형식:",
  '{"playstyle_tags": ["태그1", "태그2"], "aggression_score": 0.0, "role_preference": "duelist", "synergy_notes": "..."}',
  "",
  "필드 규칙:",
  '- playstyle_tags: 한국어 태그 2~4개 (예: ["공격형", "엔트리프래거", "클러치메이커"])',
  "- aggression_score: 0~1 사이 숫자 (킬 비중, 요원 성향, 타임라인의 공격 패턴 종합)",
  '- role_preference: "duelist" | "initiator" | "controller" | "sentinel" | "flex" 중 하나',
  "- synergy_notes: 이 유저와 어떤 성향의 파트너가 잘 맞는지 한국어 한 문장 (60자 이내)",
].join("\n");

function buildUserPrompt(input: DeepPlaystyleInput): string {
  const headshot =
    input.headshotRate == null
      ? "데이터 없음"
      : `${Math.round(input.headshotRate * 100)}%`;

  const agentLines =
    input.agentWinRates.length > 0
      ? input.agentWinRates
          .map(
            (a) =>
              `  - ${a.agent}: ${a.matches}판, 승률 ${Math.round(a.winRate * 100)}%`,
          )
          .join("\n")
      : "  - 데이터 없음";

  const clutchLine = input.clutch
    ? `${input.clutch.attempts}회 시도 중 ${input.clutch.wins}회 성공`
    : "데이터 없음";

  const timelineLines =
    input.matchTimelines.length > 0
      ? input.matchTimelines.map((t, i) => `  ${i + 1}. ${t}`).join("\n")
      : "  데이터 없음";

  return [
    `최근 ${input.matchCount}경기 전적 요약:`,
    "",
    `- KDA: ${input.kda.toFixed(2)} (평균 킬 ${input.avgKills.toFixed(1)} / 데스 ${input.avgDeaths.toFixed(1)} / 어시스트 ${input.avgAssists.toFixed(1)})`,
    `- 헤드샷률: ${headshot}`,
    `- 전체 승률: ${Math.round(input.winRate * 100)}%`,
    "- 요원별 승률:",
    agentLines,
    `- 클러치 (1vX): ${clutchLine}`,
    "- 매치별 타임라인 요약:",
    timelineLines,
  ].join("\n");
}

// ─── 응답 검증 ───────────────────────────────────────────
// 값이 깨져 있어도 화면/DB가 안전하도록 범위를 보정합니다 (gemini.ts와 동일 원칙)

function sanitizeAnalysis(raw: unknown): DeepPlaystyleAnalysis | null {
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

  const notes =
    typeof data.synergy_notes === "string"
      ? data.synergy_notes.trim().slice(0, 120)
      : null;

  if (tags === null || tags.length === 0 || score === null || role === null || notes === null) {
    return null;
  }

  return {
    playstyle_tags: tags,
    aggression_score: score,
    role_preference: role,
    synergy_notes: notes,
  };
}

// Claude가 지시를 어기고 ```json 코드블록으로 감쌌을 때를 대비한 추출
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

// ─── 메인 함수 ───────────────────────────────────────────
// 실패해도 throw 하지 않고 더미 분석을 반환합니다 (요구사항).

export async function analyzePlaystyleWithClaude(
  input: DeepPlaystyleInput,
): Promise<DeepPlaystyleAnalysis> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[claude] Claude API 미사용 - 더미 데이터 반환 (ANTHROPIC_API_KEY 미설정)");
    return buildFallbackAnalysis(input);
  }

  if (input.matchCount <= 0) {
    console.warn("[claude] Claude API 미사용 - 더미 데이터 반환 (분석할 경기 없음)");
    return buildFallbackAnalysis(input);
  }

  try {
    const response = await fetch(CLAUDE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Anthropic은 x-api-key 헤더 사용 (URL에 키를 넣으면 로그에 남을 수 있음)
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        // system 프롬프트로 역할 + "JSON만 출력" 강제
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: buildUserPrompt(input),
          },
        ],
        temperature: 0.4,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      // 402 = 크레딧 부족, 429 = rate limit, 401 = 키 오류 — 전부 더미로 폴백
      console.warn(
        `[claude] Claude API 미사용 - 더미 데이터 반환 (HTTP ${response.status})`,
      );
      return buildFallbackAnalysis(input);
    }

    const payload = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };

    // Messages API 응답: content 배열에서 text 블록을 찾습니다
    const text = payload.content?.find((block) => block.type === "text")?.text;
    if (!text) {
      console.warn("[claude] Claude API 미사용 - 더미 데이터 반환 (빈 응답)");
      return buildFallbackAnalysis(input);
    }

    const parsed = sanitizeAnalysis(JSON.parse(extractJsonText(text)));
    if (!parsed) {
      console.warn("[claude] Claude API 미사용 - 더미 데이터 반환 (응답 검증 실패)");
      return buildFallbackAnalysis(input);
    }

    return parsed;
  } catch (error) {
    // 네트워크 오류, 타임아웃, JSON.parse 실패 전부 여기로
    console.warn(
      "[claude] Claude API 미사용 - 더미 데이터 반환:",
      error instanceof Error ? error.message : "unknown error",
    );
    return buildFallbackAnalysis(input);
  }
}
