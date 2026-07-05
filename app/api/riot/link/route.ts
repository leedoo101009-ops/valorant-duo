import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  fetchRiotAccountByRiotId,
  formatRiotId,
  parseRiotId,
} from "@/lib/riot/api";
import { checkRateLimit } from "@/lib/security/rateLimit";

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;

// POST /api/riot/link
// body: { riotId: "PlayerName#KR1" }
//
// 흐름: 유저 입력 → Riot API 검증 → service_role RPC로 DB 저장
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ ok: false, message: "Login required" }, { status: 401 });
  }

  const { allowed, retryAfterSec } = checkRateLimit(
    `riot-link:${user.id}`,
    RATE_LIMIT,
    RATE_WINDOW_MS,
  );

  if (!allowed) {
    return Response.json(
      { ok: false, message: `Too many attempts. Try again in ${retryAfterSec}s.` },
      { status: 429 },
    );
  }

  if (!hasAdminClient()) {
    return Response.json(
      { ok: false, message: "Server configuration error" },
      { status: 503 },
    );
  }

  let body: { riotId?: string };
  try {
    body = (await request.json()) as { riotId?: string };
  } catch {
    return Response.json({ ok: false, message: "Invalid request body" }, { status: 400 });
  }

  const parsed = parseRiotId(body.riotId ?? "");
  if (!parsed) {
    return Response.json(
      { ok: false, message: "Invalid Riot ID format. Use Name#TAG (e.g. Player#KR1)" },
      { status: 400 },
    );
  }

  const { account, error: riotError, status: riotStatus } = await fetchRiotAccountByRiotId(
    parsed.gameName,
    parsed.tagLine,
  );

  if (!account) {
    return Response.json(
      { ok: false, message: riotError ?? "Riot account not found" },
      { status: riotStatus },
    );
  }

  const riotId = formatRiotId(account);

  const admin = createAdminClient();
  const { error } = await admin.rpc("link_riot_account", {
    p_user_id: user.id,
    p_riot_id: riotId,
    p_riot_puuid: account.puuid,
  });

  if (error) {
    if (error.code === "23505") {
      return Response.json(
        { ok: false, message: "This Riot account is already linked to another user" },
        { status: 409 },
      );
    }

    return Response.json(
      { ok: false, message: "Failed to link Riot account" },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, riot_id: riotId });
}
