import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { safeRedirectPath } from "@/lib/security/safeRedirect";

// GET /api/discord/authorize
// 로그인한 유저를 Discord OAuth( Supabase linkIdentity )로 보냅니다.
export async function GET(request: Request) {
  const { origin, searchParams } = new URL(request.url);
  const requestedNext = searchParams.get("next");
  const next = requestedNext ? safeRedirectPath(requestedNext) : "/profile?discord_linked=1";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const { allowed } = checkRateLimit(`discord-authorize:${user.id}`, 5, 60_000);
  if (!allowed) {
    return NextResponse.redirect(`${origin}/profile?discord_error=rate_limit`);
  }

  const { data, error } = await supabase.auth.linkIdentity({
    provider: "discord",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error || !data.url) {
    return NextResponse.redirect(`${origin}/profile?discord_error=authorize_failed`);
  }

  return NextResponse.redirect(data.url);
}
