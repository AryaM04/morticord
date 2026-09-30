// A limit on failed sign-in attempts for one account. The per-IP rate limit
// does not stop an attacker with many IP addresses. This guard counts the
// failures for each email address, from all IP addresses together.
// The count lives in process memory: one server process, no extra store.

/** The guard keeps at most this many email addresses. */
const MAX_KEYS = 10_000;

export interface LoginFailureGuard {
  /** True when this account had `maxFailures` failures in the time window. */
  isLocked(email: string): boolean;
  /** Record one failed attempt for this account. */
  recordFailure(email: string): void;
}

export function createLoginFailureGuard(
  maxFailures: number,
  windowMs: number,
  now: () => number = Date.now,
): LoginFailureGuard {
  const failures = new Map<string, number[]>();

  function recent(email: string): number[] {
    const time = now();
    const list = (failures.get(email) ?? []).filter((failedAt) => time - failedAt < windowMs);
    if (list.length === 0) {
      failures.delete(email);
    }
    return list;
  }

  /** Remove old entries, so that many different email addresses cannot fill the memory. */
  function prune(): void {
    const time = now();
    for (const [email, list] of failures) {
      if (time - list[list.length - 1]! >= windowMs) {
        failures.delete(email);
      }
    }
    // The Map keeps the order of insertion, so the first key is the oldest.
    while (failures.size > MAX_KEYS) {
      failures.delete(failures.keys().next().value!);
    }
  }

  return {
    isLocked(email) {
      return recent(email).length >= maxFailures;
    },
    recordFailure(email) {
      const list = recent(email);
      list.push(now());
      failures.delete(email);
      failures.set(email, list);
      if (failures.size > MAX_KEYS) {
        prune();
      }
    },
  };
}
