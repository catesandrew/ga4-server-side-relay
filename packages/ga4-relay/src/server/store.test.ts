import { describe, expect, it } from "vitest";
import { checkRateLimit, InMemoryStore, UpstashStore, type UpstashRedisLike } from "./store.js";

describe("InMemoryStore", () => {
  it("incr increments and returns the running count", async () => {
    const store = new InMemoryStore();
    expect(await store.incr("k", 1000)).toBe(1);
    expect(await store.incr("k", 1000)).toBe(2);
  });

  it("setNX only succeeds once until TTL expiry", async () => {
    const store = new InMemoryStore();
    expect(await store.setNX("k", "v", 1000)).toBe(true);
    expect(await store.setNX("k", "v2", 1000)).toBe(false);
  });

  it("get returns null for a missing key", async () => {
    const store = new InMemoryStore();
    expect(await store.get("missing")).toBeNull();
  });
});

function fakeRedis(): UpstashRedisLike {
  const data = new Map<string, string>();
  return {
    async incr(key) {
      const next = Number(data.get(key) ?? "0") + 1;
      data.set(key, String(next));
      return next;
    },
    async pexpire() {
      return 1;
    },
    async get(key) {
      return data.get(key) ?? null;
    },
    async set(key, value, opts) {
      if (opts.nx && data.has(key)) return null;
      data.set(key, value);
      return "OK";
    },
    async del(key) {
      const existed = data.delete(key);
      return existed ? 1 : 0;
    },
  };
}

describe("UpstashStore", () => {
  it("incr delegates to the redis client and expires on first write", async () => {
    const store = new UpstashStore(fakeRedis());
    expect(await store.incr("k", 1000)).toBe(1);
    expect(await store.incr("k", 1000)).toBe(2);
  });

  it("setNX respects redis NX semantics", async () => {
    const store = new UpstashStore(fakeRedis());
    expect(await store.setNX("k", "v", 1000)).toBe(true);
    expect(await store.setNX("k", "v2", 1000)).toBe(false);
  });
});

describe("checkRateLimit", () => {
  it("allows requests under the threshold", async () => {
    const store = new InMemoryStore();
    const result = await checkRateLimit(store, "key", 3, 60_000);
    expect(result.allowed).toBe(true);
  });

  it("AC25: denies once the threshold is exceeded", async () => {
    const store = new InMemoryStore();
    for (let i = 0; i < 3; i++) await checkRateLimit(store, "key", 3, 60_000);
    const result = await checkRateLimit(store, "key", 3, 60_000);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBe(60_000);
  });

  it("AC25/US-017: denies once the threshold is exceeded against a production-shaped Upstash-backed Store, not just InMemoryStore", async () => {
    const store = new UpstashStore(fakeRedis());
    for (let i = 0; i < 3; i++) await checkRateLimit(store, "key", 3, 60_000);
    const result = await checkRateLimit(store, "key", 3, 60_000);
    expect(result.allowed).toBe(false);
  });

  it("fails open when the Store throws", async () => {
    const throwingStore = {
      async incr(): Promise<number> {
        throw new Error("unreachable");
      },
      async get() {
        return null;
      },
      async setNX() {
        return true;
      },
      async del() {
        // no-op
      },
    };
    const result = await checkRateLimit(throwingStore, "key", 1, 60_000);
    expect(result.allowed).toBe(true);
  });
});
