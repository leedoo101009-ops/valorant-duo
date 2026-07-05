// Riot ID 파싱: "PlayerName#KR1" → { gameName, tagLine }
export function parseRiotId(input: string) {
  const trimmed = input.trim();
  const hashIndex = trimmed.indexOf("#");

  if (hashIndex <= 0 || hashIndex === trimmed.length - 1) {
    return null;
  }

  const gameName = trimmed.slice(0, hashIndex).trim();
  const tagLine = trimmed.slice(hashIndex + 1).trim();

  if (!gameName || !tagLine) {
    return null;
  }

  return { gameName, tagLine };
}

export type RiotAccount = {
  puuid: string;
  gameName: string;
  tagLine: string;
};

// 서버에서만 호출 — RIOT_API_KEY는 .env.local에만 둡니다.
export async function fetchRiotAccountByRiotId(
  gameName: string,
  tagLine: string,
): Promise<{ account: RiotAccount | null; error?: string; status: number }> {
  const apiKey = process.env.RIOT_API_KEY;
  const region = process.env.RIOT_API_REGION ?? "asia";

  if (!apiKey) {
    return { account: null, error: "RIOT_API_KEY not configured", status: 503 };
  }

  const url = `https://${region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;

  const response = await fetch(url, {
    headers: { "X-Riot-Token": apiKey },
    next: { revalidate: 0 },
  });

  if (response.status === 404) {
    return { account: null, error: "Riot account not found", status: 404 };
  }

  if (!response.ok) {
    return { account: null, error: "Riot API request failed", status: 502 };
  }

  const account = (await response.json()) as RiotAccount;
  return { account, status: 200 };
}

export function formatRiotId(account: RiotAccount) {
  return `${account.gameName}#${account.tagLine}`;
}
