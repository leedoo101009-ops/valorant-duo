import type { MannerGrade } from "./constants";

export type UserReputation = {
  trustScore: number;
  reviewCount: number;
  mannerGrade: MannerGrade | null;
  isNewUser: boolean;
  topTags: string[];
};

export type PendingMatchReview = {
  matchId: string;
  partner: {
    displayName: string | null;
    riotId: string | null;
  };
};

export type ReviewTagStat = {
  tag: string;
  count: number;
  kind: "positive" | "negative";
};
