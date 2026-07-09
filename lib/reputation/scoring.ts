import { NEW_USER_REVIEW_THRESHOLD, type MannerGrade } from "./constants";

export function computeReviewScore(positiveCount: number, negativeCount: number): number {
  let score = 50 + positiveCount * 12 - negativeCount * 18;
  if (score < 0) score = 0;
  if (score > 100) score = 100;
  return score;
}

export function trustToMannerGrade(trustScore: number): MannerGrade {
  if (trustScore >= 90) return "S";
  if (trustScore >= 75) return "A";
  if (trustScore >= 60) return "B";
  if (trustScore >= 40) return "C";
  return "D";
}

export function isNewReviewUser(reviewCount: number): boolean {
  return reviewCount < NEW_USER_REVIEW_THRESHOLD;
}

export const GRADE_STYLES: Record<MannerGrade, string> = {
  S: "border-[#ffd700]/60 bg-[#ffd700]/15 text-[#ffd700]",
  A: "border-[#0fbcbf]/60 bg-[#0fbcbf]/15 text-[#0fbcbf]",
  B: "border-[#6ee7b7]/50 bg-[#6ee7b7]/10 text-[#6ee7b7]",
  C: "border-[#fbbf24]/50 bg-[#fbbf24]/10 text-[#fbbf24]",
  D: "border-[#ff4655]/60 bg-[#ff4655]/15 text-[#ff4655]",
};
