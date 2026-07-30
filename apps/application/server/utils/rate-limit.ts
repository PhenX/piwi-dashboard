const store = new Map<string, { count: number; resetAt: number }>();

/**
 * Simple in-memory rate limiter. Returns true if the request is allowed.
 * @param key       Unique key (e.g. IP + endpoint)
 * @param limit     Max requests per window
 * @param windowMs  Window duration in ms
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || entry.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

/** Whether `key` has reached `limit` within its current window, without counting this call. */
export function isRateLimited(key: string, limit: number): boolean {
  const entry = store.get(key);
  if (!entry || entry.resetAt < Date.now()) return false;
  return entry.count >= limit;
}

/** Record one hit against `key`, starting a fresh window if none is active. Used to count failures. */
export function recordRateLimitHit(key: string, windowMs: number): void {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || entry.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
  } else {
    entry.count++;
  }
}

/** Clear a key's counter (e.g. after a success), so it no longer counts toward a lockout. */
export function resetRateLimit(key: string): void {
  store.delete(key);
}
