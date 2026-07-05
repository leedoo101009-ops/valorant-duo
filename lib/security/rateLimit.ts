type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const store = new Map<string, RateLimitEntry>();

// 간단한 in-memory rate limit (dev/소규모용). Vercel serverless에서는 인스턴스별로 분리됨.
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now >= entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }

  if (entry.count >= limit) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil((entry.resetAt - now) / 1000),
    };
  }

  entry.count += 1;

  if (store.size > 5000) {
    for (const [key, value] of store) {
      if (now >= value.resetAt) {
        store.delete(key);
      }
    }
  }

  return { allowed: true, retryAfterSec: 0 };
}
