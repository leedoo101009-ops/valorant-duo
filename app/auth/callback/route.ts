import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/security/safeRedirect";
import { NextResponse } from "next/server";

// 이메일 인증 링크 클릭 후 Supabase가 이 주소로 돌려보냅니다.
// code를 세션(로그인 상태)으로 바꿔서 홈으로 보냅니다.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeRedirectPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
