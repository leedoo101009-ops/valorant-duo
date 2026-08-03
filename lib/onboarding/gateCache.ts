/**
 * OnboardingGate용 세션 메모리 캐시.
 * 경로가 바뀔 때마다 /api/onboarding 을 치지 않기 위함.
 * (탭을 새로고침하면 비움 — 서버가 최종 진실)
 */

type Entry = { completed: boolean };

const cache = new Map<string, Entry>();

export function getOnboardingGateCache(userId: string): Entry | undefined {
  return cache.get(userId);
}

export function setOnboardingGateCache(userId: string, completed: boolean): void {
  cache.set(userId, { completed });
}

export function clearOnboardingGateCache(userId?: string): void {
  if (userId) {
    cache.delete(userId);
    return;
  }
  cache.clear();
}
