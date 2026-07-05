import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getDiscordIdentity } from "@/lib/discord/identity";
import { checkRateLimit } from "@/lib/security/rateLimit";

// POST /api/discord/sync
// Supabase Auth에 연결된 Discord identity → profiles 테이블에 저장
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ ok: false, message: "Login required" }, { status: 401 });
  }

  const { allowed, retryAfterSec } = checkRateLimit(
    `discord-sync:${user.id}`,
    5,
    60_000,
  );

  if (!allowed) {
    return Response.json(
      { ok: false, errorKey: "rate_limit", message: `Try again in ${retryAfterSec}s.` },
      { status: 429 },
    );
  }

  const discord = getDiscordIdentity(user);
  if (!discord) {
    return Response.json(
      { ok: false, errorKey: "not_linked", message: "Discord account not connected in Auth" },
      { status: 400 },
    );
  }

  if (!hasAdminClient()) {
    return Response.json({ ok: false, message: "Server configuration error" }, { status: 503 });
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("link_discord_account", {
    p_user_id: user.id,
    p_discord_id: discord.discordId,
    p_discord_username: discord.discordUsername,
  });

  if (error) {
    if (error.code === "23505") {
      return Response.json(
        { ok: false, errorKey: "already_linked", message: "Discord account already linked" },
        { status: 409 },
      );
    }

    return Response.json(
      { ok: false, errorKey: "save_failed", message: "Failed to save Discord account" },
      { status: 500 },
    );
  }

  return Response.json({
    ok: true,
    discord_username: discord.discordUsername,
  });
}
