// ⚠️ 로컬 개발 전용 — CI/배포 환경에서 실행 금지
// .env.local의 RIOT_API_KEY가 Valorant 전적 API에 쓸 수 있는지 상태코드만 확인합니다.
// 키 값은 출력하지 않습니다.
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local", "utf8");
function get(key) {
  const match = env.match(new RegExp(`^${key}=(.*)$`, "m"));
  return match ? match[1].trim() : "";
}

const apiKey = get("RIOT_API_KEY");
const region = get("RIOT_API_REGION") || "asia";
const shard = get("VALORANT_SHARD") || "ap";

if (!apiKey) {
  console.log(JSON.stringify({ ok: false, reason: "missing_key" }));
  process.exit(1);
}

const keyLooksLikeRiotFormat = apiKey.startsWith("RGAPI-") && apiKey.length >= 36;

const accountUrl = `https://${region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/Riot%20API%20Tester/NA1`;
const matchlistUrl = `https://${shard}.api.riotgames.com/val/match/v1/matchlists/by-puuid/00000000-0000-0000-0000-000000000000`;

const accountRes = await fetch(accountUrl, {
  headers: { "X-Riot-Token": apiKey },
});
const matchlistRes = await fetch(matchlistUrl, {
  headers: { "X-Riot-Token": apiKey },
});

let verdict = "UNEXPECTED_STATUS";
if (accountRes.status === 401 || matchlistRes.status === 401) {
  verdict = "KEY_INVALID_OR_EXPIRED";
} else if (matchlistRes.status === 403) {
  verdict = "MATCH_API_FORBIDDEN_NEED_PROD_OR_WRONG_PRODUCT";
} else if (accountRes.status === 403 && matchlistRes.status === 403) {
  verdict = "KEY_FORBIDDEN";
} else if (
  [200, 404].includes(accountRes.status) &&
  [200, 400, 404].includes(matchlistRes.status)
) {
  verdict = "PRODUCTION_KEY_LIKELY_OK";
}

console.log(
  JSON.stringify({
    keyPresent: true,
    keyLooksLikeRiotFormat,
    keyLength: apiKey.length,
    region,
    shard,
    accountApiStatus: accountRes.status,
    matchlistApiStatus: matchlistRes.status,
    verdict,
  }),
);
