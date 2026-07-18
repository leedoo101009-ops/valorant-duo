import { redirect } from "next/navigation";
import { fetchUserReputation, fetchUserReviewTagStats } from "@/lib/reputation/fetch";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/supabase/profile";
import type { ValorantMatch } from "@/lib/supabase/valorant";
import ProfileContent from "./ProfileContent";

const PROFILE_SELECT_FULL =
  "id, email, display_name, riot_id, discord_username, discord_id, last_match_sync_at, trust_score, review_count, tier, ranked_rating, created_at, updated_at";

// ranked_rating 컬럼(027)이 아직 없어도 프로필·티어는 보이게
const PROFILE_SELECT_NO_RR =
  "id, email, display_name, riot_id, discord_username, discord_id, last_match_sync_at, trust_score, review_count, tier, created_at, updated_at";

async function loadOwnProfile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<Profile | null> {
  const full = await supabase
    .from("profiles")
    .select(PROFILE_SELECT_FULL)
    .eq("id", userId)
    .maybeSingle();

  if (!full.error && full.data) {
    return full.data as Profile;
  }

  // 027 미적용 등으로 ranked_rating 컬럼이 없으면 tier만이라도 조회
  if (full.error) {
    console.warn("[profile] full select failed, retry without ranked_rating:", full.error.message);
  }

  const partial = await supabase
    .from("profiles")
    .select(PROFILE_SELECT_NO_RR)
    .eq("id", userId)
    .maybeSingle();

  if (partial.error) {
    console.warn("[profile] tier select failed:", partial.error.message);
    return null;
  }

  if (!partial.data) {
    return null;
  }

  return { ...(partial.data as Profile), ranked_rating: null };
}

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  let profile = await loadOwnProfile(supabase, user.id);

  if (!profile) {
    const fallbackName = user.email?.split("@")[0] ?? "player";
    const { data: created, error: createError } = await supabase
      .from("profiles")
      .insert({
        id: user.id,
        email: user.email ?? null,
        display_name: fallbackName,
      })
      .select(PROFILE_SELECT_NO_RR)
      .single();

    if (createError) {
      console.warn("[profile] create failed:", createError.message);
    }

    profile = created
      ? ({ ...(created as Profile), ranked_rating: null } as Profile)
      : null;
  }

  const { data: matches } = await supabase
    .from("valorant_matches")
    .select(
      "id, match_id, map_name, queue_id, agent_name, kills, deaths, assists, score, rounds_played, won, played_at",
    )
    .eq("user_id", user.id)
    .order("played_at", { ascending: false })
    .limit(10);

  const [reputation, tagStats] = await Promise.all([
    fetchUserReputation(user.id),
    fetchUserReviewTagStats(user.id),
  ]);

  return (
    <ProfileContent
      profile={
        profile ?? {
          id: user.id,
          email: user.email ?? null,
          display_name: user.email?.split("@")[0] ?? "player",
          riot_id: null,
          discord_username: null,
          discord_id: null,
          last_match_sync_at: null,
          trust_score: 70,
          review_count: 0,
          tier: null,
          ranked_rating: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
      }
      initialMatches={(matches ?? []) as ValorantMatch[]}
      reputation={reputation}
      tagStats={tagStats}
    />
  );
}
