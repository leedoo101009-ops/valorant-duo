import { createClient } from "@/lib/supabase/server";
import { ensureProfile } from "@/lib/supabase/profile";
import { recordTermsAcceptance } from "@/lib/legal/recordTermsAcceptance";
import { resolvePostAuthPath } from "@/lib/onboarding/redirect";
import { safeRedirectPath } from "@/lib/security/safeRedirect";
import { NextResponse } from "next/server";

// 이메일 인증 / Google OAuth 후 Supabase가 이 주소로 돌려보냅니다.
// code를 세션(로그인 상태)으로 바꾼 뒤, 온보딩 미완료면 /onboarding 으로 보냅니다.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeRedirectPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      await ensureProfile(supabase, data.user);

      // 미기록(null)일 때만 저장 — 신규·기존 미기록 모두 커버, 이미 있으면 no-op
      await recordTermsAcceptance(data.user.id);

      // next가 /onboarding이면 그대로, 아니면 온보딩 여부에 따라 분기
      const dest =
        next === "/onboarding"
          ? next
          : await resolvePostAuthPath(supabase, data.user.id, next);
      return NextResponse.redirect(`${origin}${dest}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
