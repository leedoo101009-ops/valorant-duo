// 리뷰 태그 키 — DB·API·UI에서 동일하게 사용
export const POSITIVE_REVIEW_TAGS = [
  "friendly",
  "good_comms",
  "skilled",
  "punctual",
  "team_player",
] as const;

export const NEGATIVE_REVIEW_TAGS = [
  "toxic",
  "afk",
  "bad_comms",
  "griefing",
  "rude",
] as const;

export type PositiveReviewTag = (typeof POSITIVE_REVIEW_TAGS)[number];
export type NegativeReviewTag = (typeof NEGATIVE_REVIEW_TAGS)[number];
export type ReviewTag = PositiveReviewTag | NegativeReviewTag;

export const ALL_REVIEW_TAGS: readonly ReviewTag[] = [
  ...POSITIVE_REVIEW_TAGS,
  ...NEGATIVE_REVIEW_TAGS,
];

// review_count가 이 값 미만이면 등급 대신 "신규 유저" 뱃지
export const NEW_USER_REVIEW_THRESHOLD = 3;

// 리뷰 작성 가능 기간 (게임 종료 후)
export const REVIEW_WINDOW_DAYS = 7;

export type MannerGrade = "S" | "A" | "B" | "C" | "D";
