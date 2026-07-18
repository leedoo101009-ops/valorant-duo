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
  RankedRatingAfterUpdate?: number;
  AfterUpdate?: {
    TierAfterUpdate?: number;
    RankedRatingAfterUpdate?: number;
  };
};

type CompetitiveUpdatesResponse = {
  Matches?: CompetitiveUpdateMatch[];
  matches?: CompetitiveUpdateMatch[];
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

function readRankedRatingAfterUpdate(match: CompetitiveUpdateMatch): number | null {
  const nested = match.AfterUpdate?.RankedRatingAfterUpdate;
  if (typeof nested === "number" && Number.isFinite(nested)) {
    return Math.max(0, Math.min(9999, Math.round(nested)));
  }

  const flat = match.RankedRatingAfterUpdate;
  if (typeof flat === "number" && Number.isFinite(flat)) {
    return Math.max(0, Math.min(9999, Math.round(flat)));
  }

  return null;
}

export type CompetitiveRankResult = {
  riotTier: number | null;
  tierIndex: number | null;
  rankedRating: number | null;
  errorKey?: RiotApiErrorKey;
  status: number;
};

async function fetchCompetitiveUpdatesOnShard(
  puuid: string,
  shard: string,
  apiKey: string,
): Promise<CompetitiveRankResult> {
  const normalizedShard = shard.trim().toLowerCase();
  // startIndex/endIndex: 최근 경쟁전 기록 범위 (문서·실사용 모두 호환)
  const url = `https://${normalizedShard}.api.riotgames.com/val/ranked/v1/competitiveupdates/by-puuid/${encodeURIComponent(puuid)}?startIndex=0&endIndex=20`;

  const response = await fetch(url, {
    headers: { "X-Riot-Token": apiKey },
    cache: "no-store",
  });

  if (!response.ok) {
    const { errorKey, status } = mapRiotHttpError(response.status);
    return {
      riotTier: null,
      tierIndex: null,
      rankedRating: null,
      errorKey,
      status,
    };
  }

  const data = (await response.json()) as CompetitiveUpdatesResponse;
  const matches = data.Matches ?? data.matches ?? [];

  if (matches.length === 0) {
    return { riotTier: null, tierIndex: null, rankedRating: null, status: 200 };
  }

  // TierAfterUpdate=0(언랭)인 판은 건너뛰고, 실제 티어가 있는 최근 판을 씀
  for (const match of matches) {
    const riotTier = readTierAfterUpdate(match);
    if (riotTier == null) continue;

    const tierIndex = riotTierToProfileIndex(riotTier);
    if (tierIndex == null) continue;

    return {
      riotTier,
      tierIndex,
      rankedRating: readRankedRatingAfterUpdate(match),
      status: 200,
    };
  }

  return { riotTier: null, tierIndex: null, rankedRating: null, status: 200 };
}

// Riot competitiveupdates 시도 — 공개 Production API의 VAL-RANKED는
// 공식적으로 리더보드만 문서화되어 있고, 개인 RR(RankedRating)은
// 클라이언트용 private API(pd.*.a.pvp.net + RSO)에만 있습니다.
// 이 함수가 RR을 못 주는 경우가 정상일 수 있음 → 전적 competitiveTier 폴백 사용.
export async function fetchValorantCompetitiveTier(
  puuid: string,
  shard: string,
): Promise<CompetitiveRankResult> {
  const apiKey = getRiotApiKey();
  if (!apiKey) {
    return {
      riotTier: null,
      tierIndex: null,
      rankedRating: null,
      errorKey: "server_error",
      status: 503,
    };
  }

  const preferred = shard.trim().toLowerCase();
  const candidates = [...new Set([preferred, "kr", "ap"].filter(Boolean))];

  let lastError: CompetitiveRankResult | null = null;

  for (let i = 0; i < candidates.length; i += 1) {
    const result = await fetchCompetitiveUpdatesOnShard(puuid, candidates[i], apiKey);

    if (
      result.errorKey === "api_key_expired" ||
      result.errorKey === "production_key_required" ||
      result.errorKey === "rate_limit"
    ) {
      return result;
    }

    if (result.tierIndex != null) {
      return result;
    }

    if (result.errorKey) {
      lastError = result;
    }
  }

  if (lastError?.errorKey) {
    return lastError;
  }

  return { riotTier: null, tierIndex: null, rankedRating: null, status: 200 };
}
