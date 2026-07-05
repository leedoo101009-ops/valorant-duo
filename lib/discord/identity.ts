import type { User } from "@supabase/supabase-js";

export type DiscordProfile = {
  discordId: string;
  discordUsername: string;
};

// Supabase Auth에 연결된 Discord identity에서 프로필 저장용 필드 추출
export function getDiscordIdentity(user: User): DiscordProfile | null {
  const identity = user.identities?.find((item) => item.provider === "discord");
  if (!identity) {
    return null;
  }

  const data = identity.identity_data ?? {};
  const discordId =
    (typeof data.provider_id === "string" && data.provider_id) ||
    (typeof data.sub === "string" && data.sub) ||
    identity.id;

  const customClaims = data.custom_claims as { global_name?: string } | undefined;
  const discordUsername =
    (typeof customClaims?.global_name === "string" && customClaims.global_name) ||
    (typeof data.full_name === "string" && data.full_name) ||
    (typeof data.name === "string" && data.name) ||
    (typeof data.preferred_username === "string" && data.preferred_username) ||
    `discord_${discordId}`;

  if (!discordId) {
    return null;
  }

  return { discordId, discordUsername };
}
