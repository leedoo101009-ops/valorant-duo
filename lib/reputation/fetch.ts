import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { isNewReviewUser, trustToMannerGrade } from "./scoring";
import type { ReviewTagStat, UserReputation } from "./types";

export async function fetchUserReputation(userId: string): Promise<UserReputation | null> {
  if (!hasAdminClient()) {
    return null;
  }

  const admin = createAdminClient();
  const { data: profile, error } = await admin
    .from("profiles")
    .select("trust_score, review_count")
    .eq("id", userId)
    .maybeSingle();

  if (error || !profile) {
    return null;
  }

  const trustScore = profile.trust_score ?? 70;
  const reviewCount = profile.review_count ?? 0;
  const isNewUser = isNewReviewUser(reviewCount);
  const topTags = await fetchTopReviewTags(userId, 2);

  return {
    trustScore,
    reviewCount,
    mannerGrade: isNewUser ? null : trustToMannerGrade(trustScore),
    isNewUser,
    topTags,
  };
}

export async function fetchTopReviewTags(userId: string, limit = 2): Promise<string[]> {
  if (!hasAdminClient()) {
    return [];
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_user_top_review_tags", {
    p_user_id: userId,
    p_limit: limit,
  });

  if (error || !Array.isArray(data)) {
    return [];
  }

  return data.filter((tag): tag is string => typeof tag === "string");
}

export async function fetchUserReviewTagStats(userId: string): Promise<ReviewTagStat[]> {
  if (!hasAdminClient()) {
    return [];
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_user_review_tag_stats", {
    p_user_id: userId,
  });

  if (error || !Array.isArray(data)) {
    return [];
  }

  return data
    .map((row) => {
      if (
        typeof row !== "object" ||
        row === null ||
        typeof (row as { tag?: unknown }).tag !== "string" ||
        typeof (row as { count?: unknown }).count !== "number" ||
        ((row as { kind?: unknown }).kind !== "positive" &&
          (row as { kind?: unknown }).kind !== "negative")
      ) {
        return null;
      }

      return {
        tag: (row as { tag: string }).tag,
        count: (row as { count: number }).count,
        kind: (row as { kind: "positive" | "negative" }).kind,
      };
    })
    .filter((row): row is ReviewTagStat => row !== null);
}
