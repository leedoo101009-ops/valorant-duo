// Supabase 연결에 필요한 환경변수 이름을 한곳에서 관리합니다.
// 나중에 키 이름이 바뀌어도 이 파일만 수정하면 됩니다.

export const supabaseEnvKeys = {
  url: "NEXT_PUBLIC_SUPABASE_URL",
  anonKey: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
} as const;

export function getSupabaseEnv() {
  // 서버(API Route, proxy) 전용 — 동적 접근 가능
  const url = process.env[supabaseEnvKeys.url];
  const anonKey = process.env[supabaseEnvKeys.anonKey];

  return { url, anonKey };
}

// 브라우저 번들용 — NEXT_PUBLIC_ 이름을 직접 적어야 Next.js가 값을 주입함
export function getPublicSupabaseEnv() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

export function hasSupabaseEnv() {
  const { url, anonKey } = getSupabaseEnv();
  return Boolean(url && anonKey);
}
