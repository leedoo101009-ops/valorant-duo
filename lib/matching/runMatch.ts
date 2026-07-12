// 스마트 매칭 실행 (A안) — DB 후보 조회 → TS 궁합 계산 → 매치 생성
//
// 역할 분담:
//   - DB(get_match_queue_candidates): 같은 shard·활성·미매칭 후보만 가져옴 (하드 필터 일부)
//   - TS(findBestMatch): 티어/궁합/시간완화로 최적 상대 선택 (순수 로직)
//   - DB(create_duo_match): 원자적으로 재검증 후 매치 생성 (동시성 안전)
//
// best-effort: 실패해도 예외를 밖으로 던지지 않습니다. 큐 등록/상태 조회를 막으면 안 되므로.

import type { SupabaseClient } from "@supabase/supabase-js";
import { findBestMatch, type MatchProfile } from "@/lib/matching/matcher";

// get_match_queue_candidates RPC가 돌려주는 행 형태
type CandidateRow = {
  user_id: string;
  joined_at: string;
  tier: number | null;
  aggression_score: number | null;
  role_preference: string | null;
  seconds_since_last_seen: number;
};

export type SmartMatchResult = {
  matched: boolean;
  matchId: string | null;
  partnerId: string | null;
  synergyScore: number | null;
};

function toMatchProfile(row: CandidateRow): MatchProfile {
  return {
    id: row.user_id,
    tier: row.tier,
    aggressionScore: row.aggression_score,
    rolePreference: row.role_preference,
    secondsSinceLastSeen: row.seconds_since_last_seen,
  };
}

// userId에게 가장 궁합 좋은 상대를 찾아 매치를 생성합니다.
// 동시성: create_duo_match RPC가 for update skip locked + 재검증으로 경쟁 상황 처리.
export async function attemptSmartMatch(
  admin: SupabaseClient,
  userId: string,
): Promise<SmartMatchResult> {
  const empty: SmartMatchResult = {
    matched: false,
    matchId: null,
    partnerId: null,
    synergyScore: null,
  };

  const { data: profile } = await admin
    .from("profiles")
    .select("valorant_shard")
    .eq("id", userId)
    .maybeSingle();

  const shard = profile?.valorant_shard as string | null | undefined;
  if (!shard) {
    return empty;
  }

  const { data, error } = await admin.rpc("get_match_queue_candidates", {
    p_shard: shard,
  });

  if (error || !Array.isArray(data)) {
    return empty;
  }

  const rows = data as CandidateRow[];
  const mine = rows.find((row) => row.user_id === userId);
  if (!mine) {
    return empty;
  }

  const others = rows
    .filter((row) => row.user_id !== userId)
    .map(toMatchProfile);

  if (others.length === 0) {
    return empty;
  }

  const waitTimeSeconds = Math.max(
    0,
    (Date.now() - new Date(mine.joined_at).getTime()) / 1000,
  );

  const best = findBestMatch(toMatchProfile(mine), others, waitTimeSeconds);
  if (!best) {
    return empty;
  }

  const { data: matchId, error: createError } = await admin.rpc("create_duo_match", {
    p_user_a: userId,
    p_user_b: best.user.id,
  });

  if (createError || typeof matchId !== "string") {
    return empty;
  }

  return {
    matched: true,
    matchId,
    partnerId: best.user.id,
    synergyScore: best.synergyScore,
  };
}
