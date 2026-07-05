import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";

// GET /api/supabase/health
// Supabase 연결이 되는지 확인하는 테스트용 API입니다.
// production에서는 비활성화 — 배포 후에도 외부에서 접근할 수 없게 합니다.
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new Response(null, { status: 404 });
  }

  if (!hasSupabaseEnv()) {
    return Response.json(
      {
        ok: false,
        message:
          ".env.local에 NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY를 넣어 주세요.",
      },
      { status: 503 },
    );
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.getSession();

    if (error) {
      return Response.json(
        { ok: false, message: "Supabase 연결 실패", error: error.message },
        { status: 502 },
      );
    }

    return Response.json({
      ok: true,
      message: "Supabase 연결 성공",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";

    return Response.json({ ok: false, message }, { status: 500 });
  }
}
