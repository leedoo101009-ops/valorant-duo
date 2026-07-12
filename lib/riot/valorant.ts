import "server-only";

import { getAgentName, parseMapName } from "@/lib/riot/agents";
import { mapRiotHttpError, type RiotApiErrorKey } from "@/lib/riot/errors";

const DEFAULT_MATCH_COUNT = 5;
const API_DELAY_MS = 250;

// 한국은 kr, 그 외 아시아는 ap. 잘못된 샤드로 치면 400/404가 납니다.
const FALLBACK_SHARDS = ["kr", "ap"] as const;

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

type ActiveShardResponse = {
  puuid: string;
  game: string;
  activeShard: string;
};

function getConfiguredShard() {
  const configured = process.env.VALORANT_SHARD?.trim().toLowerCase();
  return configured || null;
}

function getRiotApiKey() {
  return process.env.RIOT_API_KEY;
}

function getAccountRegion() {
  return process.env.RIOT_API_REGION ?? "asia";
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

function uniqueShards(preferred: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const shard of preferred) {
    if (!shard) continue;
    const normalized = shard.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

// 유저가 실제로 플레이하는 Valorant 서버(shard)를 조회합니다.
// 한국 계정은 보통 "kr" — "ap"로 치면 전적이 안 나옵니다.
export async function fetchValorantActiveShard(puuid: string): Promise<{
  shard: string | null;
  errorKey?: RiotApiErrorKey;
  status: number;
}> {
  const apiKey = getRiotApiKey();
  if (!apiKey) {
    return { shard: null, errorKey: "server_error", status: 503 };
  }

  const region = getAccountRegion();
  const url = `https://${region}.api.riotgames.com/riot/account/v1/active-shards/by-game/val/by-puuid/${encodeURIComponent(puuid)}`;

  const response = await fetch(url, {
    headers: riotHeaders(apiKey),
    cache: "no-store",
  });

  if (!response.ok) {
    const { errorKey, status } = mapRiotHttpError(response.status);
    return { shard: null, errorKey, status };
  }

  const data = (await response.json()) as ActiveShardResponse;
  const shard = data.activeShard?.trim().toLowerCase() || null;
  return { shard, status: 200 };
}

export async function fetchValorantMatchList(
  puuid: string,
  shard: string,
  count = DEFAULT_MATCH_COUNT,
): Promise<{
  entries: MatchListEntry[];
  errorKey?: RiotApiErrorKey;
  status: number;
}> {
  const apiKey = getRiotApiKey();

  if (!apiKey) {
    return { entries: [], errorKey: "server_error", status: 503 };
  }

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
  shard: string,
): Promise<{
  match: MatchDetailResponse | null;
  errorKey?: RiotApiErrorKey;
  status: number;
}> {
  const apiKey = getRiotApiKey();

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

async function resolveMatchlist(
  puuid: string,
  count: number,
): Promise<{
  entries: MatchListEntry[];
  shard: string | null;
  errorKey?: RiotApiErrorKey;
  status: number;
}> {
  const { shard: activeShard } = await fetchValorantActiveShard(puuid);

  const candidates = uniqueShards([
    activeShard,
    getConfiguredShard(),
    ...FALLBACK_SHARDS,
  ]);

  let lastErrorKey: RiotApiErrorKey | undefined;
  let lastStatus = 502;

  for (let i = 0; i < candidates.length; i += 1) {
    if (i > 0) {
      await sleep(API_DELAY_MS);
    }

    const shard = candidates[i];
    const result = await fetchValorantMatchList(puuid, shard, count);

    // 키/권한 문제는 샤드를 바꿔도 동일 — 바로 중단
    if (
      result.errorKey === "api_key_expired" ||
      result.errorKey === "production_key_required" ||
      result.errorKey === "rate_limit"
    ) {
      return {
        entries: [],
        shard,
        errorKey: result.errorKey,
        status: result.status,
      };
    }

    if (result.status === 200) {
      return { entries: result.entries, shard, status: 200 };
    }

    lastErrorKey = result.errorKey;
    lastStatus = result.status;
  }

  return {
    entries: [],
    shard: null,
    errorKey: lastErrorKey ?? "not_found",
    status: lastStatus,
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
  shard?: string | null;
  errorKey?: RiotApiErrorKey;
  status: number;
}> {
  const {
    entries,
    shard,
    errorKey,
    status: listStatus,
  } = await resolveMatchlist(puuid, count);

  if (errorKey && entries.length === 0) {
    return {
      matches: [],
      fetched: 0,
      skipped: 0,
      shard,
      errorKey,
      status: listStatus,
    };
  }

  if (!shard || entries.length === 0) {
    return { matches: [], fetched: 0, skipped: 0, shard, status: 200 };
  }

  const matches: ParsedValorantMatch[] = [];
  let skipped = 0;

  for (let i = 0; i < entries.length; i += 1) {
    if (i > 0) {
      await sleep(API_DELAY_MS);
    }

    const entry = entries[i];
    const { match, errorKey: detailError, status } = await fetchValorantMatchDetail(
      entry.matchId,
      shard,
    );

    if (status === 429) {
      // 일부라도 가져왔으면 그건 저장하고, 한도 메시지는 호출 쪽에서 처리
      return {
        matches,
        fetched: matches.length,
        skipped,
        shard,
        errorKey: detailError ?? "rate_limit",
        status: 429,
      };
    }

    if (detailError === "production_key_required" || detailError === "api_key_expired") {
      return {
        matches,
        fetched: matches.length,
        skipped,
        shard,
        errorKey: detailError,
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

  return { matches, fetched: matches.length, skipped, shard, status: 200 };
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
