import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ValorantMatch } from "@/lib/supabase/valorant";
import ProfileContent from "./ProfileContent";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const profileSelect =
    "id, email, display_name, riot_id, discord_username, discord_id, last_match_sync_at, created_at, updated_at";

  let { data: profile } = await supabase
    .from("profiles")
    .select(profileSelect)
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    const fallbackName = user.email?.split("@")[0] ?? "player";
    const { data: created } = await supabase
      .from("profiles")
      .insert({
        id: user.id,
        email: user.email ?? null,
        display_name: fallbackName,
      })
      .select(profileSelect)
      .single();

    profile = created;
  }

  const { data: matches } = await supabase
    .from("valorant_matches")
    .select(
      "id, match_id, map_name, queue_id, agent_name, kills, deaths, assists, score, rounds_played, won, played_at",
    )
    .eq("user_id", user.id)
    .order("played_at", { ascending: false })
    .limit(10);

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
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
      }
      initialMatches={(matches ?? []) as ValorantMatch[]}
    />
  );
}
