import "server-only";

import { mapRiotHttpError, type RiotApiErrorKey } from "@/lib/riot/errors";

// Riot competitive tier ID → profiles.tier 인덱스 (Iron1=0 … Radiant=26)
// Riot API: 0=언랭, 3=Iron1 … 27=Radiant
export function riotTierToProfileIndex(riotTier: number): number | null {
  if (riotTier <= 0 || riotTier === 1 || riotTier === 2) {
    return null;
  }

  if (riotTier === 27) {
    return 26;
  }

  if (riotTier >= 3 && riotTier <= 26) {
    return riotTier - 3;
  }

  return null;
}

type CompetitiveUpdateMatch = {
  TierAfterUpdate?: number;
  AfterUpdate?: {
    TierAfterUpdate?: number;
  };
};

type CompetitiveUpdatesResponse = {
  Matches?: CompetitiveUpdateMatch[];
};

function getRiotApiKey() {
  return process.env.RIOT_API_KEY;
}

function readTierAfterUpdate(match: CompetitiveUpdateMatch): number | null {
  const nested = match.AfterUpdate?.TierAfterUpdate;
  if (typeof nested === "number") {
    return nested;
  }

  const flat = match.TierAfterUpdate;
  if (typeof flat === "number") {
    return flat;
  }

  return null;
}

// Riot competitiveupdates API로 현재 랭크 tier ID 조회
export async function fetchValorantCompetitiveTier(
  puuid: string,
  shard: string,
): Promise<{
  riotTier: number | null;
  tierIndex: number | null;
  errorKey?: RiotApiErrorKey;
  status: number;
}> {
  const apiKey = getRiotApiKey();
  if (!apiKey) {
    return { riotTier: null, tierIndex: null, errorKey: "server_error", status: 503 };
  }

  const normalizedShard = shard.trim().toLowerCase();
  const url = `https://${normalizedShard}.api.riotgames.com/val/ranked/v1/competitiveupdates/by-puuid/${encodeURIComponent(puuid)}`;

  const response = await fetch(url, {
    headers: { "X-Riot-Token": apiKey },
    cache: "no-store",
  });

  if (!response.ok) {
    const { errorKey, status } = mapRiotHttpError(response.status);
    return { riotTier: null, tierIndex: null, errorKey, status };
  }

  const data = (await response.json()) as CompetitiveUpdatesResponse;
  const matches = data.Matches ?? [];

  if (matches.length === 0) {
    return { riotTier: null, tierIndex: null, status: 200 };
  }

  const riotTier = readTierAfterUpdate(matches[0]);
  if (riotTier == null) {
    return { riotTier: null, tierIndex: null, status: 200 };
  }

  return {
    riotTier,
    tierIndex: riotTierToProfileIndex(riotTier),
    status: 200,
  };
}
