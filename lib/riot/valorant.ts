import { getAgentName, parseMapName } from "@/lib/riot/agents";
import { mapRiotHttpError, type RiotApiErrorKey } from "@/lib/riot/errors";

const DEFAULT_MATCH_COUNT = 10;
const API_DELAY_MS = 150;

export type ParsedValorantMatch = {
  match_id: string;
  map_name: string;
  queue_id: string;
  agent_name: string;
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  rounds_played: number;
  won: boolean;
  played_at: string;
};

type MatchListEntry = {
  matchId: string;
  gameStartTime: number;
  queueId?: string;
};

type MatchListResponse = {
  puuid: string;
  history: MatchListEntry[];
};

type MatchPlayer = {
  puuid: string;
  teamId: string;
  characterId: string;
  stats?: {
    score: number;
    roundsPlayed: number;
    kills: number;
    deaths: number;
    assists: number;
  };
};

type MatchTeam = {
  teamId: string;
  won: boolean;
};

type MatchDetailResponse = {
  matchInfo: {
    matchId: string;
    mapId: string;
    queueId: string;
    gameStartMillis: number;
    isCompleted: boolean;
  };
  players: MatchPlayer[];
  teams: MatchTeam[];
};

function getValorantShard() {
  return process.env.VALORANT_SHARD ?? "ap";
}

function getRiotApiKey() {
  return process.env.RIOT_API_KEY;
}

function riotHeaders(apiKey: string) {
  return { "X-Riot-Token": apiKey };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function valorantBaseUrl(shard: string) {
  return `https://${shard}.api.riotgames.com`;
}

export async function fetchValorantMatchList(
  puuid: string,
  count = DEFAULT_MATCH_COUNT,
): Promise<{
  entries: MatchListEntry[];
  error?: string;
  errorKey?: RiotApiErrorKey;
  status: number;
}> {
  const apiKey = getRiotApiKey();
  const shard = getValorantShard();

  if (!apiKey) {
    return { entries: [], error: "RIOT_API_KEY not configured", errorKey: "server_error", status: 503 };
  }

  // 공식 API는 startIndex/endIndex 미지원 — 목록 받은 뒤 slice
  const url = `${valorantBaseUrl(shard)}/val/match/v1/matchlists/by-puuid/${encodeURIComponent(puuid)}`;

  const response = await fetch(url, {
    headers: riotHeaders(apiKey),
    cache: "no-store",
  });

  if (!response.ok) {
    const { errorKey, status } = mapRiotHttpError(response.status);
    return { entries: [], errorKey, status };
  }

  const data = (await response.json()) as MatchListResponse;
  const entries = (data.history ?? []).slice(0, count);
  return { entries, status: 200 };
}

export async function fetchValorantMatchDetail(
  matchId: string,
): Promise<{
  match: MatchDetailResponse | null;
  errorKey?: RiotApiErrorKey;
  status: number;
}> {
  const apiKey = getRiotApiKey();
  const shard = getValorantShard();

  if (!apiKey) {
    return { match: null, errorKey: "server_error", status: 503 };
  }

  const url = `${valorantBaseUrl(shard)}/val/match/v1/matches/${encodeURIComponent(matchId)}`;

  const response = await fetch(url, {
    headers: riotHeaders(apiKey),
    cache: "no-store",
  });

  if (!response.ok) {
    const { errorKey, status } = mapRiotHttpError(response.status);
    return { match: null, errorKey, status };
  }

  const match = (await response.json()) as MatchDetailResponse;
  return { match, status: 200 };
}

export function parsePlayerMatchStats(
  match: MatchDetailResponse,
  puuid: string,
): ParsedValorantMatch | null {
  const player = match.players.find((p) => p.puuid === puuid);
  if (!player?.stats) {
    return null;
  }

  const team = match.teams.find((t) => t.teamId === player.teamId);
  const won = team?.won ?? false;

  return {
    match_id: match.matchInfo.matchId,
    map_name: parseMapName(match.matchInfo.mapId),
    queue_id: match.matchInfo.queueId,
    agent_name: getAgentName(player.characterId),
    kills: player.stats.kills,
    deaths: player.stats.deaths,
    assists: player.stats.assists,
    score: player.stats.score,
    rounds_played: player.stats.roundsPlayed,
    won,
    played_at: new Date(match.matchInfo.gameStartMillis).toISOString(),
  };
}

// 매치 목록 → 상세 조회 → 파싱 (Riot rate limit 준수를 위해 호출 사이 딜레이)
export async function collectRecentValorantMatches(
  puuid: string,
  count = DEFAULT_MATCH_COUNT,
): Promise<{
  matches: ParsedValorantMatch[];
  fetched: number;
  skipped: number;
  errorKey?: RiotApiErrorKey;
  status: number;
}> {
  const { entries, errorKey, status: listStatus } = await fetchValorantMatchList(
    puuid,
    count,
  );

  if (errorKey && entries.length === 0) {
    return { matches: [], fetched: 0, skipped: 0, errorKey, status: listStatus };
  }

  if (entries.length === 0) {
    return { matches: [], fetched: 0, skipped: 0, status: 200 };
  }

  const matches: ParsedValorantMatch[] = [];
  let skipped = 0;

  for (let i = 0; i < entries.length; i += 1) {
    if (i > 0) {
      await sleep(API_DELAY_MS);
    }

    const entry = entries[i];
    const { match, errorKey, status } = await fetchValorantMatchDetail(entry.matchId);

    if (status === 429) {
      return {
        matches,
        fetched: matches.length,
        skipped,
        errorKey: errorKey ?? "rate_limit",
        status: 429,
      };
    }

    if (errorKey === "production_key_required" || errorKey === "api_key_expired") {
      return {
        matches,
        fetched: matches.length,
        skipped,
        errorKey,
        status,
      };
    }

    if (!match) {
      skipped += 1;
      continue;
    }

    if (!match.matchInfo.isCompleted) {
      skipped += 1;
      continue;
    }

    const parsed = parsePlayerMatchStats(match, puuid);
    if (!parsed) {
      skipped += 1;
      continue;
    }

    matches.push(parsed);
  }

  return { matches, fetched: matches.length, skipped, status: 200 };
}

export const SYNC_COOLDOWN_MS = 5 * 60 * 1000;

export function getSyncCooldownRemaining(lastSyncAt: string | null | undefined): number {
  if (!lastSyncAt) {
    return 0;
  }

  const elapsed = Date.now() - new Date(lastSyncAt).getTime();
  const remaining = SYNC_COOLDOWN_MS - elapsed;
  return remaining > 0 ? remaining : 0;
}
