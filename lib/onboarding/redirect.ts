import type { SupabaseClient } from "@supabase/supabase-js";

/** 온보딩 미완료면 /onboarding, 아니면 fallback 경로 */
export async function resolvePostAuthPath(
  supabase: SupabaseClient,
  userId: string,
  fallback = "/",
): Promise<string> {
  const { data } = await supabase
    .from("profiles")
    .select("onboarding_completed")
    .eq("id", userId)
    .maybeSingle();

  if (data && data.onboarding_completed === false) {
    return "/onboarding";
  }

  // 컬럼이 아직 없거나(마이그레이션 전) null이면 기존 유저로 보고 홈
  if (data?.onboarding_completed == null) {
    return fallback;
  }

  return data.onboarding_completed ? fallback : "/onboarding";
}
