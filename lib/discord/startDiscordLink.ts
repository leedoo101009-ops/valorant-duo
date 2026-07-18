// 브라우저에서 Discord OAuth를 바로 시작
//
// 왜 /api/discord/authorize 를 안 거치나?
//   예전: 클릭 → Vercel API(콜드 스타트) → Supabase → Discord
//   지금: 클릭 → Supabase(브라우저) → Discord
//   우리 서버를 한 번 덜 거쳐서 "디코로 가는" 체감이 빨라집니다.
//
// /api/discord/authorize 는 북마크·구링크 호환용으로 남겨 둡니다.

import { createClient } from "@/lib/supabase/client";
import { safeRedirectPath } from "@/lib/security/safeRedirect";

export type StartDiscordLinkResult = {
  ok: boolean;
  errorKey?: "login_required" | "authorize_failed" | "rate_limited";
};

// ──────────────────────────────────────────────
// 클라이언트 쓰로틀: 5분 안에 5번 초과하면 차단
// 왜 필요한가?
//   서버 /api/discord/authorize 는 분당 5회 제한이 있었지만
//   클라이언트 직접 호출로 바꾸면서 그 제한이 사라짐.
//   악의적/실수 연타 클릭이 Supabase Auth에 과도한 요청을 보내는 걸 방지.
// ──────────────────────────────────────────────
const THROTTLE_KEY = "discord_link_attempts";
const THROTTLE_MAX = 5;
const THROTTLE_WINDOW_MS = 5 * 60 * 1000; // 5분

function checkAndRecordAttempt(): boolean {
  // localStorage 에 타임스탬프 배열을 저장해 최근 시도 횟수 추적
  try {
    const raw = localStorage.getItem(THROTTLE_KEY);
    const timestamps: number[] = raw ? (JSON.parse(raw) as number[]) : [];
    const now = Date.now();
    // 5분 이내 시도만 남김
    const recent = timestamps.filter((t) => now - t < THROTTLE_WINDOW_MS);
    if (recent.length >= THROTTLE_MAX) {
      // 한도 초과 — 기록만 갱신하고 false 반환
      localStorage.setItem(THROTTLE_KEY, JSON.stringify(recent));
      return false;
    }
    recent.push(now);
    localStorage.setItem(THROTTLE_KEY, JSON.stringify(recent));
    return true;
  } catch {
    // localStorage 접근 불가(사생활 보호 모드 등) → 허용
    return true;
  }
}

export async function startDiscordLink(
  nextPath: string = "/profile?discord_linked=1",
): Promise<StartDiscordLinkResult> {
  // 쓰로틀 체크: 5분 내 5회 초과 시 차단
  if (!checkAndRecordAttempt()) {
    console.warn("[discord] rate limited (client-side throttle)");
    return { ok: false, errorKey: "rate_limited" };
  }

  const next = safeRedirectPath(nextPath);
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // 로그인 안 됐으면 OAuth 대신 로그인으로
    window.location.assign("/login");
    return { ok: false, errorKey: "login_required" };
  }

  const origin = window.location.origin;
  const { data, error } = await supabase.auth.linkIdentity({
    provider: "discord",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error || !data.url) {
    console.warn("[discord] linkIdentity failed:", error?.message ?? "no url");
    return { ok: false, errorKey: "authorize_failed" };
  }

  // Discord 공식 로그인 페이지로 즉시 이동
  window.location.assign(data.url);
  return { ok: true };
}
