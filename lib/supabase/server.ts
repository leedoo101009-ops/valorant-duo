import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "./env";

// 서버(API Route, Server Component)에서 Supabase를 쓸 때 사용합니다.
// 로그인 세션(쿠키)을 서버에서 읽을 수 있어서, 나중에 인증 기능에 필요합니다.
export async function createClient() {
  const { url, anonKey } = getSupabaseEnv();

  if (!url || !anonKey) {
    throw new Error(
      "Supabase 환경변수가 없습니다. .env.local 파일을 확인해 주세요.",
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Component에서는 쿠키 set이 막힐 수 있어서 무시합니다.
          // 로그인 기능 추가할 때 middleware에서 세션 갱신을 처리합니다.
        }
      },
    },
  });
}
