import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { fetchPartnerPublicProfile } from "@/lib/match/partner";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/security/rateLimit";

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

export type ActiveMatchResponse = {
  id: string;
  createdAt: string;
  myVoicePreference: "valorant" | "discord" | "none" | null;
  partnerVoicePreference: "valorant" | "discord" | "none" | null;
  partyCode: string | null;
  partyCodeByMe: boolean;
  me: {
    discordUsername: string | null;
    discordId: string | null;
  };
  partner: {
    displayName: string | null;
    riotId: string | null;
    discordUsername: string | null;
    discordId: string | null;
  };
};

async function getActiveMatchForUser(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<ActiveMatchResponse | null> {
  const { data: match } = await supabase
    .from("duo_matches")
    .select(
      "id, user_a_id, user_b_id, created_at, user_a_voice_preference, user_b_voice_preference, party_code, party_code_by",
    )
    .eq("status", "active")
    .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
    .maybeSingle();

  if (!match) {
    return null;
  }

  const partnerId = match.user_a_id === userId ? match.user_b_id : match.user_a_id;
  const isUserA = match.user_a_id === userId;
  const partner = await fetchPartnerPublicProfile(partnerId);
  const { data: me } = await supabase
    .from("profiles")
    .select("discord_username, discord_id")
    .eq("id", userId)
    .maybeSingle();

  if (!partner) {
    return null;
  }

  const myVoicePreference = isUserA
    ? match.user_a_voice_preference
    : match.user_b_voice_preference;
  const partnerVoicePreference = isUserA
    ? match.user_b_voice_preference
    : match.user_a_voice_preference;
  const sharePartnerDiscord = partnerVoicePreference === "discord";

  return {
    id: match.id,
    createdAt: match.created_at,
    myVoicePreference,
    partnerVoicePreference,
    partyCode: match.party_code,
    partyCodeByMe: match.party_code_by === userId,
    me: {
      discordUsername: me?.discord_username ?? null,
      discordId: me?.discord_id ?? null,
    },
    partner: {
      displayName: partner.displayName,
      riotId: partner.riotId,
      discordUsername: sharePartnerDiscord ? partner.discordUsername : null,
      discordId: sharePartnerDiscord ? partner.discordId : null,
    },
  };
}

// GET /api/match/queue/status
export async function GET(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  const { allowed, retryAfterSec } = checkRateLimit(
    `match-queue-status:${ip}`,
    RATE_LIMIT,
    RATE_WINDOW_MS,
  );

  if (!allowed) {
    return Response.json(
      { ok: false, errorKey: "rate_limit", retryAfterSec },
      { status: 429 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: queueCount, error: countError } = await supabase.rpc("count_queue_users");

  if (countError) {
    return Response.json({ ok: false, errorKey: "server_error" }, { status: 500 });
  }

  const count = typeof queueCount === "number" ? queueCount : 0;

  if (!user) {
    return Response.json({
      ok: true,
      queueCount: count,
      inQueue: false,
      joinedAt: null,
      activeMatch: null,
    });
  }

  if (hasAdminClient()) {
    const admin = createAdminClient();
    await admin.rpc("process_match_queue");
  }

  const activeMatch = await getActiveMatchForUser(supabase, user.id);

  if (activeMatch) {
    return Response.json({
      ok: true,
      queueCount: count,
      inQueue: false,
      joinedAt: null,
      activeMatch,
    });
  }

  const { data: entry } = await supabase
    .from("match_queue_entries")
    .select("joined_at")
    .eq("user_id", user.id)
    .maybeSingle();

  return Response.json({
    ok: true,
    queueCount: count,
    inQueue: Boolean(entry),
    joinedAt: entry?.joined_at ?? null,
    activeMatch: null,
  });
}
