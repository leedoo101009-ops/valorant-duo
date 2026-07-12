import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { forbiddenUnlessTrustedOrigin } from "@/lib/security/apiGuards";
import { createClient } from "@/lib/supabase/server";
import {
  fetchRiotAccountByRiotId,
  formatRiotId,
  parseRiotId,
} from "@/lib/riot/api";
import { mapRiotHttpError } from "@/lib/riot/errors";
import { fetchValorantActiveShard } from "@/lib/riot/valorant";
import { checkRateLimit } from "@/lib/security/rateLimit";

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;

// POST /api/riot/link
// body: { riotId: "PlayerName#KR1" }
//
// 흐름: 유저 입력 → Riot API 검증 → service_role RPC로 DB 저장
export async function POST(request: Request) {
  const originBlock = forbiddenUnlessTrustedOrigin(request);
  if (originBlock) {
    return originBlock;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ ok: false, errorKey: "login_required" }, { status: 401 });
  }

  const { allowed, retryAfterSec } = checkRateLimit(
    `riot-link:${user.id}`,
    RATE_LIMIT,
    RATE_WINDOW_MS,
  );

  if (!allowed) {
    return Response.json(
      { ok: false, errorKey: "rate_limit", retryAfterSec },
      { status: 429 },
    );
  }

  if (!hasAdminClient()) {
    return Response.json({ ok: false, errorKey: "server_error" }, { status: 503 });
  }

  let body: { riotId?: string };
  try {
    body = (await request.json()) as { riotId?: string };
  } catch {
    return Response.json({ ok: false, errorKey: "invalid_body" }, { status: 400 });
  }

  const parsed = parseRiotId(body.riotId ?? "");
  if (!parsed) {
    return Response.json({ ok: false, errorKey: "invalid_riot_id" }, { status: 400 });
  }

  const { account, status: riotStatus } = await fetchRiotAccountByRiotId(
    parsed.gameName,
    parsed.tagLine,
  );

  if (!account) {
    // 서버 내부 메시지(예: RIOT_API_KEY not configured)를 클라이언트에 그대로 보내지 않습니다.
    // API 키 이름은 해커에게 "어디를 노리면 되는지" 힌트가 됩니다.
    const mapped =
      riotStatus === 404
        ? { errorKey: "not_found" as const, status: 404 }
        : mapRiotHttpError(riotStatus);
    return Response.json({ ok: false, errorKey: mapped.errorKey }, { status: mapped.status });
  }

  const riotId = formatRiotId(account);
  const { shard } = await fetchValorantActiveShard(account.puuid);

  const admin = createAdminClient();
  const { error } = await admin.rpc("link_riot_account", {
    p_user_id: user.id,
    p_riot_id: riotId,
    p_riot_puuid: account.puuid,
  });

  if (error) {
    if (error.code === "23505") {
      return Response.json({ ok: false, errorKey: "already_linked" }, { status: 409 });
    }

    return Response.json({ ok: false, errorKey: "server_error" }, { status: 500 });
  }

  if (shard) {
    // active-shard는 같은 서버 유저끼리만 매칭하기 위한 값입니다.
    await admin.from("profiles").update({ valorant_shard: shard }).eq("id", user.id);
  }

  return Response.json({ ok: true, riot_id: riotId, valorant_shard: shard });
}
