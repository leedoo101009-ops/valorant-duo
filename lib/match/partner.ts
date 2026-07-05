import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";

export type PartnerPublicProfile = {
  displayName: string | null;
  riotId: string | null;
  discordUsername: string | null;
  discordId: string | null;
};

export async function fetchPartnerPublicProfile(
  partnerId: string,
): Promise<PartnerPublicProfile | null> {
  if (!hasAdminClient()) {
    return null;
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("display_name, riot_id, discord_username, discord_id")
    .eq("id", partnerId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    displayName: data.display_name,
    riotId: data.riot_id,
    discordUsername: data.discord_username,
    discordId: data.discord_id,
  };
}
