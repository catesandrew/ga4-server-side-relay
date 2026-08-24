/**
 * Store interface (plan step 1.6). TTL is a parameter on every write
 * method, not a separate concern — both the rate-limit window and the
 * 48h dedupe TTL need to express expiry through the same interface.
 */
export interface Store {
  incr(key: string, ttlMs: number): Promise<number>;
  get(key: string): Promise<string | null>;
  setNX(key: string, value: string, ttlMs: number): Promise<boolean>;
  /** Releases a dedupe reservation (see dedupe-store.ts's release()) — needed when the thing the key guarded never actually completed. */
  del(key: string): Promise<void>;
}

interface Entry {
  value: number | string;
  expiresAt: number;
}

/**
 * Development-only in-memory Store. NOT a production guarantee: Vercel's
 * multi-instance/cold-start model means these counters are per-instance
 * and do not survive across requests reliably in production. Rate limiting
 * against this store in production is rejected at construction time
 * (see create-relay.ts, AC23).
 */
export class InMemoryStore implements Store {
  private readonly map = new Map<string, Entry>();

  private prune(key: string): void {
    const entry = this.map.get(key);
    if (entry && entry.expiresAt < Date.now()) this.map.delete(key);
  }

  async incr(key: string, ttlMs: number): Promise<number> {
    this.prune(key);
    const existing = this.map.get(key);
    const next = (typeof existing?.value === "number" ? existing.value : 0) + 1;
    this.map.set(key, { value: next, expiresAt: Date.now() + ttlMs });
    return next;
  }

  async get(key: string): Promise<string | null> {
    this.prune(key);
    const entry = this.map.get(key);
    return entry ? String(entry.value) : null;
  }

  async setNX(key: string, value: string, ttlMs: number): Promise<boolean> {
    this.prune(key);
    if (this.map.has(key)) return false;
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
    return true;
  }

  async del(key: string): Promise<void> {
    this.map.delete(key);
  }
}

export interface UpstashRedisLike {
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts: { nx: true; px: number }): Promise<string | null>;
  del(key: string): Promise<number>;
}

/** Production-grade Store backed by Upstash Redis (region colocation is a stated deployment requirement). */
export class UpstashStore implements Store {
  constructor(private readonly redis: UpstashRedisLike) {}

  async incr(key: string, ttlMs: number): Promise<number> {
    const value = await this.redis.incr(key);
    if (value === 1) await this.redis.pexpire(key, ttlMs);
    return value;
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async setNX(key: string, value: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.set(key, value, { nx: true, px: ttlMs });
    return result !== null;
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }
}

/**
 * Rate limiting fails open: a Store error lets the request proceed rather
 * than the site going dark. Explicit accepted risk, not a silent gap.
 */
export async function checkRateLimit(
  store: Store,
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ allowed: boolean; retryAfterMs?: number }> {
  try {
    const count = await store.incr(`ratelimit:${key}`, windowMs);
    if (count > limit) {
      return { allowed: false, retryAfterMs: windowMs };
    }
    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}
