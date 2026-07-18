// profiles.tier (0~26) → 화면용 티어 이름
// Iron1=0 … Immortal3=23, Radiant=26 (24·25는 Riot 매핑상 비는 슬롯)

const TIER_LABELS_EN: Record<number, string> = {
  0: "Iron 1",
  1: "Iron 2",
  2: "Iron 3",
  3: "Bronze 1",
  4: "Bronze 2",
  5: "Bronze 3",
  6: "Silver 1",
  7: "Silver 2",
  8: "Silver 3",
  9: "Gold 1",
  10: "Gold 2",
  11: "Gold 3",
  12: "Platinum 1",
  13: "Platinum 2",
  14: "Platinum 3",
  15: "Diamond 1",
  16: "Diamond 2",
  17: "Diamond 3",
  18: "Ascendant 1",
  19: "Ascendant 2",
  20: "Ascendant 3",
  21: "Immortal 1",
  22: "Immortal 2",
  23: "Immortal 3",
  24: "Immortal 3",
  25: "Immortal 3",
  26: "Radiant",
};

const TIER_LABELS_KO: Record<number, string> = {
  0: "아이언 1",
  1: "아이언 2",
  2: "아이언 3",
  3: "브론즈 1",
  4: "브론즈 2",
  5: "브론즈 3",
  6: "실버 1",
  7: "실버 2",
  8: "실버 3",
  9: "골드 1",
  10: "골드 2",
  11: "골드 3",
  12: "플래티넘 1",
  13: "플래티넘 2",
  14: "플래티넘 3",
  15: "다이아몬드 1",
  16: "다이아몬드 2",
  17: "다이아몬드 3",
  18: "초월자 1",
  19: "초월자 2",
  20: "초월자 3",
  21: "불멸 1",
  22: "불멸 2",
  23: "불멸 3",
  24: "불멸 3",
  25: "불멸 3",
  26: "레디언트",
};

export function formatValorantTierLabel(
  tier: number | null | undefined,
  locale: "ko" | "en" = "ko",
): string | null {
  if (tier == null || !Number.isInteger(tier) || tier < 0 || tier > 26) {
    return null;
  }

  const labels = locale === "ko" ? TIER_LABELS_KO : TIER_LABELS_EN;
  return labels[tier] ?? null;
}
