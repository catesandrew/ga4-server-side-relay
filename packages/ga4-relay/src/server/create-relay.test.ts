import { afterEach, describe, expect, it, vi } from "vitest";
import { createGa4Relay } from "./create-relay.js";
import { InMemoryStore, UpstashStore, type UpstashRedisLike } from "./store.js";

function baseConfig() {
  return {
    measurementId: "G-TEST",
    apiSecret: "secret",
    tokenSecret: "token-secret",
    allowedOrigins: ["https://example.com"],
    store: new InMemoryStore(),
  };
}

describe("createGa4Relay — AC23 construction-time validation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws when apiSecret is missing", () => {
    expect(() => createGa4Relay({ ...baseConfig(), apiSecret: "" })).toThrow(/apiSecret/);
  });

  it("throws when tokenSecret is missing", () => {
    expect(() => createGa4Relay({ ...baseConfig(), tokenSecret: "" })).toThrow(/tokenSecret/);
  });

  it("throws when rate limiting is enabled with the in-memory Store in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => createGa4Relay(baseConfig())).toThrow(/in-memory Store/);
  });

  it("does not throw with the in-memory Store outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(() => createGa4Relay(baseConfig())).not.toThrow();
  });

  it("does not throw in production when using the Upstash Store", () => {
    vi.stubEnv("NODE_ENV", "production");
    const fakeRedis: UpstashRedisLike = {
      incr: async () => 1,
      pexpire: async () => 1,
      get: async () => null,
      set: async () => "OK",
      del: async () => 1,
    };
    expect(() => createGa4Relay({ ...baseConfig(), store: new UpstashStore(fakeRedis) })).not.toThrow();
  });

  it("returns a fully-formed relay object on valid config", () => {
    vi.stubEnv("NODE_ENV", "test");
    const relay = createGa4Relay(baseConfig());
    expect(typeof relay.createCollectHandler).toBe("function");
    expect(typeof relay.createDebugHandler).toBe("function");
    expect(typeof relay.createServiceWorkerHandler).toBe("function");
    expect(typeof relay.withGa4Token).toBe("function");
  });
});
