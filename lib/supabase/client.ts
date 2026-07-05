import { createBrowserClient } from "@supabase/ssr";

// 브라우저(클라이언트)에서 Supabase를 쓸 때 사용합니다.
//
// ⚠️ NEXT_PUBLIC_ 변수는 아래처럼 이름을 직접 적어야 합니다.
// process.env[변수명] 처럼 동적으로 읽으면 Next.js가 빌드 시 값을 넣지 못해
// 브라우저에서는 undefined가 됩니다. (서버 API는 정상인데 Navbar만 터지는 이유)
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase 환경변수가 없습니다. .env.local 파일을 확인해 주세요.",
    );
  }

  return createBrowserClient(url, anonKey);
}
