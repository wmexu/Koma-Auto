interface RateLimitRecord {
  attempts: number;
  blockedUntil: number | null;
  firstAttemptAt: number;
}

const LIMITS_STORE = new Map<string, RateLimitRecord>();

const MAX_ATTEMPTS = 3;
const BLOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const WINDOW_DURATION_MS = 15 * 60 * 1000; // 15 minutes window

/**
 * Checks whether the given key (IP or user ID) is rate-limited.
 * Returns { allowed: true } or { allowed: false, remainingSeconds: number }
 */
export function checkRateLimit(key: string): { allowed: boolean; remainingSeconds?: number } {
  const now = Date.now();
  const record = LIMITS_STORE.get(key);

  if (!record) {
    return { allowed: true };
  }

  // If blocked
  if (record.blockedUntil && record.blockedUntil > now) {
    const remainingSeconds = Math.ceil((record.blockedUntil - now) / 1000);
    return { allowed: false, remainingSeconds };
  }

  // If window expired, reset
  if (now - record.firstAttemptAt > WINDOW_DURATION_MS) {
    LIMITS_STORE.delete(key);
    return { allowed: true };
  }

  // If exceeded max attempts
  if (record.attempts >= MAX_ATTEMPTS) {
    record.blockedUntil = now + BLOCK_DURATION_MS;
    return { allowed: false, remainingSeconds: Math.ceil(BLOCK_DURATION_MS / 1000) };
  }

  return { allowed: true };
}

/**
 * Records a failed attempt for the given key.
 */
export function recordFailedAttempt(key: string): { blocked: boolean; remainingAttempts: number; remainingSeconds?: number } {
  const now = Date.now();
  let record = LIMITS_STORE.get(key);

  if (!record || now - record.firstAttemptAt > WINDOW_DURATION_MS) {
    record = { attempts: 1, blockedUntil: null, firstAttemptAt: now };
  } else {
    record.attempts += 1;
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    record.blockedUntil = now + BLOCK_DURATION_MS;
    LIMITS_STORE.set(key, record);
    return {
      blocked: true,
      remainingAttempts: 0,
      remainingSeconds: Math.ceil(BLOCK_DURATION_MS / 1000),
    };
  }

  LIMITS_STORE.set(key, record);
  return {
    blocked: false,
    remainingAttempts: MAX_ATTEMPTS - record.attempts,
  };
}

/**
 * Resets/clears failed attempts upon successful verification.
 */
export function resetRateLimit(key: string): void {
  LIMITS_STORE.delete(key);
}
