import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { fetchPartnerPublicProfile } from "@/lib/match/partner";
import { fetchUserReputation } from "@/lib/reputation/fetch";
import type { PendingMatchReview } from "@/lib/reputation/types";
import { REVIEW_WINDOW_DAYS } from "@/lib/reputation/constants";

export async function getPendingMatchReview(
  userId: string,
): Promise<PendingMatchReview | null> {
  if (!hasAdminClient()) {
    return null;
  }

  const admin = createAdminClient();
  const since = new Date(Date.now() - REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: match } = await admin
    .from("duo_matches")
    .select("id, user_a_id, user_b_id, updated_at")
    .eq("status", "completed")
    .not("in_game_at", "is", null)
    .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
    .gte("updated_at", since)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!match) {
    return null;
  }

  const { data: existingReview, error: reviewError } = await admin
    .from("duo_match_reviews")
    .select("id")
    .eq("match_id", match.id)
    .eq("reviewer_id", userId)
    .maybeSingle();

  // migration 015 미적용 시 테이블 없음 — 리뷰 기능만 비활성, 매칭은 정상 동작
  if (reviewError) {
    return null;
  }

  if (existingReview) {
    return null;
  }

  const partnerId = match.user_a_id === userId ? match.user_b_id : match.user_a_id;
  const partner = await fetchPartnerPublicProfile(partnerId);

  if (!partner) {
    return null;
  }

  return {
    matchId: match.id,
    partner: {
      displayName: partner.displayName,
      riotId: partner.riotId,
    },
  };
}

export async function fetchPartnerWithReputation(partnerId: string) {
  const [partner, reputation] = await Promise.all([
    fetchPartnerPublicProfile(partnerId),
    fetchUserReputation(partnerId),
  ]);

  if (!partner) {
    return null;
  }

  return {
    displayName: partner.displayName,
    riotId: partner.riotId,
    discordUsername: partner.discordUsername,
    discordId: partner.discordId,
    reputation,
  };
}
