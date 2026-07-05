const SEEN_PREFIX = "match-guidelines-seen-";
const HIDDEN_UNTIL_PREFIX = "match-guidelines-hidden-until-";
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function hasSeenMatchGuidelines(userId: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return localStorage.getItem(`${SEEN_PREFIX}${userId}`) === "1";
}

export function isMatchGuidelinesHidden(userId: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const hiddenUntil = localStorage.getItem(`${HIDDEN_UNTIL_PREFIX}${userId}`);
  if (!hiddenUntil) {
    return false;
  }

  const expiresAt = Number(hiddenUntil);
  if (Number.isNaN(expiresAt) || Date.now() >= expiresAt) {
    localStorage.removeItem(`${HIDDEN_UNTIL_PREFIX}${userId}`);
    return false;
  }

  return true;
}

// 첫 매칭은 무조건 표시, 이후에는 1주일 숨김 설정이 없으면 표시
export function shouldShowMatchGuidelines(userId: string): boolean {
  if (!hasSeenMatchGuidelines(userId)) {
    return true;
  }

  return !isMatchGuidelinesHidden(userId);
}

export function markMatchGuidelinesSeen(userId: string, hideForOneWeek: boolean): void {
  localStorage.setItem(`${SEEN_PREFIX}${userId}`, "1");

  if (hideForOneWeek) {
    localStorage.setItem(`${HIDDEN_UNTIL_PREFIX}${userId}`, String(Date.now() + ONE_WEEK_MS));
  }
}
