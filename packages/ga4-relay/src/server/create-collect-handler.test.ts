import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCollectHandler } from "./create-collect-handler.js";
import { InMemoryStore } from "./store.js";
import { mintToken, signCaptureIdentity } from "./token.js";
import { CLIENT_ID_COOKIE } from "./cookies.js";
import { TOKEN_COOKIE_NAME } from "./token.js";
import { GA4_TOKEN_HEADER } from "./with-token-middleware.js";
import { UpstashStore, type UpstashRedisLike } from "./store.js";
import { startMockMpServer, type MockMpServer } from "../../test/mock-mp-server.js";
import type { Ga4Event } from "../shared/event.js";

const ORIGIN = "https://example.com";
const TOKEN_SECRET = "test-token-secret";

async function makeHandler(mockServer: MockMpServer, overrides: Partial<Parameters<typeof createCollectHandler>[0]> = {}) {
  let pending: Promise<void> | undefined;
  const handler = createCollectHandler(
    {
      measurementId: "G-TEST",
      apiSecret: "api-secret",
      tokenSecret: TOKEN_SECRET,
      allowedOrigins: [ORIGIN],
      store: new InMemoryStore(),
      endpointBaseOverride: mockServer.url,
      ...overrides,
    },
    { runAfterResponse: (cb) => { pending = cb(); } },
  );
  return {
    handler,
    waitForForward: async () => {
      await pending;
    },
  };
}

async function tokenCookie(): Promise<string> {
  const token = await mintToken(ORIGIN, TOKEN_SECRET);
  return `${TOKEN_COOKIE_NAME}=${token}`;
}

function makeEvent(overrides: Partial<Ga4Event> = {}): Ga4Event {
  return { event_id: crypto.randomUUID(), name: "page_view", params: {}, ...overrides };
}

function request(body: unknown, headers: Record<string, string>): Request {
  return new Request("https://relay.example.com/collect", {
    method: "POST",
    body: JSON.stringify(body),
    headers,
  });
}

describe("createCollectHandler", () => {
  let mockServer: MockMpServer;

  beforeEach(async () => {
    mockServer = await startMockMpServer();
  });

  afterEach(async () => {
    await mockServer.close();
  });

  it("AC7: rejects a request whose Origin is outside the allowlist", async () => {
    const { handler, waitForForward } = await makeHandler(mockServer);
    const res = await handler(
      request({ events: [makeEvent()] }, { origin: "https://evil.example.com", cookie: await tokenCookie() }),
    );
    await waitForForward();
    expect(res.status).toBe(403);
    expect(mockServer.requests).toHaveLength(0);
  });

  it("AC8: rejects a request with a missing token", async () => {
    const { handler } = await makeHandler(mockServer);
    const res = await handler(request({ events: [makeEvent()] }, { origin: ORIGIN }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.retryable).toBe("needs-token-refresh");
  });

  it("AC1: forwards a valid page_view to the mock MP server", async () => {
    const { handler, waitForForward } = await makeHandler(mockServer);
    const res = await handler(
      request(
        { events: [makeEvent()], consent: grantedConsent() },
        { origin: ORIGIN, cookie: await tokenCookie() },
      ),
    );
    await waitForForward();
    expect(res.status).toBe(200);
    expect(mockServer.requests).toHaveLength(1);
    expect(mockServer.requests[0]?.body).toMatchObject({ client_id: expect.any(String) });
  });

  it("AC2: mints a client_id cookie on first contact and returns identity in the body", async () => {
    const { handler, waitForForward } = await makeHandler(mockServer);
    const res = await handler(
      request(
        { events: [makeEvent()], consent: grantedConsent() },
        { origin: ORIGIN, cookie: await tokenCookie() },
      ),
    );
    await waitForForward();
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(CLIENT_ID_COOKIE);
    const body = await res.json();
    expect(body.client_id).toBeTruthy();
    expect(body.signature).toBeTruthy();
  });

  describe("AC5: ip_override sourcing", () => {
    it("uses x-vercel-forwarded-for, never the client-supplied x-forwarded-for", async () => {
      const { handler, waitForForward } = await makeHandler(mockServer);
      await handler(
        request(
          { events: [makeEvent()], consent: grantedConsent() },
          {
            origin: ORIGIN,
            cookie: await tokenCookie(),
            "x-vercel-forwarded-for": "203.0.113.9",
            "x-forwarded-for": "6.6.6.6",
          },
        ),
      );
      await waitForForward();
      expect(mockServer.requests[0]?.body).toMatchObject({ ip_override: "203.0.113.9" });
    });

    it("omits ip_override entirely when no platform header is present", async () => {
      const { handler, waitForForward } = await makeHandler(mockServer);
      await handler(
        request(
          { events: [makeEvent()], consent: grantedConsent() },
          { origin: ORIGIN, cookie: await tokenCookie(), "x-forwarded-for": "6.6.6.6" },
        ),
      );
      await waitForForward();
      expect((mockServer.requests[0]?.body as Record<string, unknown>).ip_override).toBeUndefined();
    });
  });

  describe("AC6/AC6a/AC31: consent gating", () => {
    it("AC6: denied consent produces no persistent cookie, no body, no MP call", async () => {
      const { handler, waitForForward } = await makeHandler(mockServer);
      const res = await handler(
        request({ events: [makeEvent()], consent: deniedConsent() }, { origin: ORIGIN, cookie: await tokenCookie() }),
      );
      await waitForForward();
      expect(res.status).toBe(204);
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(mockServer.requests).toHaveLength(0);
    });

    it("AC6a: an absent consent object is treated as denied (default-deny)", async () => {
      const { handler, waitForForward } = await makeHandler(mockServer);
      const res = await handler(request({ events: [makeEvent()] }, { origin: ORIGIN, cookie: await tokenCookie() }));
      await waitForForward();
      expect(res.status).toBe(204);
      expect(mockServer.requests).toHaveLength(0);
    });

    it("AC31: explicit denial with an existing cookie triggers deletion headers, not persistent ones", async () => {
      const { handler, waitForForward } = await makeHandler(mockServer);
      const res = await handler(
        request(
          { events: [makeEvent()], consent: deniedConsent() },
          { origin: ORIGIN, cookie: `${await tokenCookie()}; ${CLIENT_ID_COOKIE}=v1:existing` },
        ),
      );
      await waitForForward();
      expect(res.status).toBe(204);
      const setCookies = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
      const clientIdCookie = setCookies.find((c) => c.startsWith(CLIENT_ID_COOKIE));
      expect(clientIdCookie).toContain("Max-Age=0");
    });

    it("does not attempt deletion for an absent consent object even with an existing cookie", async () => {
      const { handler, waitForForward } = await makeHandler(mockServer);
      const res = await handler(
        request({ events: [makeEvent()] }, { origin: ORIGIN, cookie: `${await tokenCookie()}; ${CLIENT_ID_COOKIE}=v1:existing` }),
      );
      await waitForForward();
      expect(res.status).toBe(204);
      expect(res.headers.get("set-cookie")).toBeNull();
    });
  });

  describe("AC22/AC24: replay path", () => {
    it("AC22: rejects a replay with an invalid signature", async () => {
      const { handler, waitForForward } = await makeHandler(mockServer);
      const res = await handler(
        request(
          {
            events: [makeEvent()],
            consent: grantedConsent(),
            replay: { client_id: "abc", ga_session_id: "s1", ga_session_number: 1, issued_at: Date.now(), signature: "bad" },
          },
          { origin: ORIGIN, cookie: await tokenCookie() },
        ),
      );
      await waitForForward();
      expect(res.status).toBe(400);
      expect(mockServer.requests).toHaveLength(0);
    });

    it("AC24: rejects a validly-signed replay whose client_id doesn't match the live cookie", async () => {
      const signed = await signCaptureIdentity(
        { client_id: "someone-elses-id", ga_session_id: "s1", ga_session_number: 1 },
        TOKEN_SECRET,
      );
      const { handler, waitForForward } = await makeHandler(mockServer);
      const res = await handler(
        request(
          { events: [makeEvent()], consent: grantedConsent(), replay: signed },
          { origin: ORIGIN, cookie: `${await tokenCookie()}; ${CLIENT_ID_COOKIE}=v1:my-real-id` },
        ),
      );
      await waitForForward();
      expect(res.status).toBe(400);
      expect(mockServer.requests).toHaveLength(0);
    });

    it("accepts a validly-signed replay whose client_id matches the live cookie", async () => {
      const signed = await signCaptureIdentity(
        { client_id: "my-real-id", ga_session_id: "s1", ga_session_number: 1 },
        TOKEN_SECRET,
      );
      const { handler, waitForForward } = await makeHandler(mockServer);
      const res = await handler(
        request(
          { events: [makeEvent()], consent: grantedConsent(), replay: signed },
          { origin: ORIGIN, cookie: `${await tokenCookie()}; ${CLIENT_ID_COOKIE}=v1:my-real-id` },
        ),
      );
      await waitForForward();
      expect(res.status).toBe(204);
      expect(mockServer.requests).toHaveLength(1);
      expect(mockServer.requests[0]?.body).toMatchObject({ client_id: "my-real-id" });
    });
  });

  it("AC9: posting the same event_id twice produces exactly one outbound MP call", async () => {
    const store = new InMemoryStore();
    const event = makeEvent();
    const { handler, waitForForward } = await makeHandler(mockServer, { store });
    const cookie = await tokenCookie();
    await handler(request({ events: [event], consent: grantedConsent() }, { origin: ORIGIN, cookie }));
    await waitForForward();
    const { handler: handler2, waitForForward: wait2 } = await makeHandler(mockServer, { store });
    await handler2(request({ events: [event], consent: grantedConsent() }, { origin: ORIGIN, cookie }));
    await wait2();
    expect(mockServer.requests).toHaveLength(1);
  });

  it("AC10: a batch of 40 events is split into two MP requests", async () => {
    const events = Array.from({ length: 40 }, () => makeEvent());
    const { handler, waitForForward } = await makeHandler(mockServer);
    await handler(request({ events, consent: grantedConsent() }, { origin: ORIGIN, cookie: await tokenCookie() }));
    await waitForForward();
    expect(mockServer.requests).toHaveLength(2);
  });

  it("AC11: an over-length event name is dropped, never forwarded", async () => {
    const { handler, waitForForward } = await makeHandler(mockServer);
    await handler(
      request(
        { events: [makeEvent({ name: "a".repeat(41) })], consent: grantedConsent() },
        { origin: ORIGIN, cookie: await tokenCookie() },
      ),
    );
    await waitForForward();
    expect(mockServer.requests).toHaveLength(0);
  });

  describe("rate limiting (AC25/AC29)", () => {
    it("returns 429 once the per-kid threshold is exceeded", async () => {
      const cookie = await tokenCookie();
      const store = new InMemoryStore();
      const { handler, waitForForward } = await makeHandler(mockServer, {
        store,
        rateLimit: { limit: 1, windowMs: 60_000 },
      });
      const first = await handler(request({ events: [makeEvent()], consent: grantedConsent() }, { origin: ORIGIN, cookie }));
      await waitForForward();
      expect(first.status).toBe(200);
      const second = await handler(request({ events: [makeEvent()], consent: grantedConsent() }, { origin: ORIGIN, cookie }));
      expect(second.status).toBe(429);
      const body = await second.json();
      expect(body.retryable).toBe(true);
    });
  });

  describe("same-request token propagation (middleware -> route handler)", () => {
    it("accepts a token forwarded via the header even with no cookie present", async () => {
      // Reproduces the fix for: a cookie set via middleware's Set-Cookie is
      // only visible to the BROWSER's next request, not the one Next.js is
      // currently forwarding to the route handler — so the handler must
      // accept the token via GA4_TOKEN_HEADER on THIS request too, or a
      // clean browser's first-ever request always 401s.
      const { handler, waitForForward } = await makeHandler(mockServer);
      const token = await mintToken(ORIGIN, TOKEN_SECRET);
      const res = await handler(
        request(
          { events: [makeEvent()], consent: grantedConsent() },
          { origin: ORIGIN, [GA4_TOKEN_HEADER]: token }, // no "cookie" header at all
        ),
      );
      await waitForForward();
      expect(res.status).toBe(200);
      expect(mockServer.requests).toHaveLength(1);
    });

    it("prefers the header over a stale cookie when both are present", async () => {
      const staleToken = await mintToken(ORIGIN, TOKEN_SECRET, Date.now() - 20 * 60 * 1000); // expired
      const freshToken = await mintToken(ORIGIN, TOKEN_SECRET);
      const { handler, waitForForward } = await makeHandler(mockServer);
      const res = await handler(
        request(
          { events: [makeEvent()], consent: grantedConsent() },
          { origin: ORIGIN, cookie: `${TOKEN_COOKIE_NAME}=${staleToken}`, [GA4_TOKEN_HEADER]: freshToken },
        ),
      );
      await waitForForward();
      expect(res.status).toBe(200);
    });
  });

  describe("token origin binding", () => {
    it("rejects a validly-signed token minted for a different origin", async () => {
      const tokenForOtherOrigin = await mintToken("https://not-this-site.example.com", TOKEN_SECRET);
      const { handler } = await makeHandler(mockServer);
      const res = await handler(
        request(
          { events: [makeEvent()], consent: grantedConsent() },
          { origin: ORIGIN, cookie: `${TOKEN_COOKIE_NAME}=${tokenForOtherOrigin}` },
        ),
      );
      expect(res.status).toBe(401);
    });
  });

  describe("malformed body shape", () => {
    it("returns a clean 400 for events:[null] instead of throwing", async () => {
      const { handler } = await makeHandler(mockServer);
      const res = await handler(
        request({ events: [null] }, { origin: ORIGIN, cookie: await tokenCookie() }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.retryable).toBe(false);
    });

    it("returns a clean 400 (not a 500 crash) for a malformed replay object", async () => {
      // A prior version reached hmac.ts's verifySignature with
      // signature===undefined and threw a TypeError, producing a 500
      // (codex critic review round 3, reproduced live).
      const { handler } = await makeHandler(mockServer);
      const res = await handler(
        request(
          { events: [makeEvent()], consent: grantedConsent(), replay: {} },
          { origin: ORIGIN, cookie: await tokenCookie() },
        ),
      );
      expect(res.status).toBe(400);
    });

    it("rejects an event whose params is an array instead of an object", async () => {
      const { handler, waitForForward } = await makeHandler(mockServer);
      const res = await handler(
        request(
          { events: [{ event_id: crypto.randomUUID(), name: "page_view", params: [null] }], consent: grantedConsent() },
          { origin: ORIGIN, cookie: await tokenCookie() },
        ),
      );
      await waitForForward();
      expect(res.status).toBe(400);
      expect(mockServer.requests).toHaveLength(0);
    });
  });

  it("bounds a future-claimed capturedAtMs instead of forwarding it to MP as-is", async () => {
    const signed = await signCaptureIdentity(
      { client_id: "my-real-id", ga_session_id: "s1", ga_session_number: 1 },
      TOKEN_SECRET,
    );
    const { handler, waitForForward } = await makeHandler(mockServer);
    const futureMs = Date.now() + 60_000; // 60s in the future
    await handler(
      request(
        { events: [makeEvent()], consent: grantedConsent(), replay: signed, capturedAtMs: futureMs },
        { origin: ORIGIN, cookie: `${await tokenCookie()}; ${CLIENT_ID_COOKIE}=v1:my-real-id` },
      ),
    );
    await waitForForward();
    const body = mockServer.requests[0]?.body as { timestamp_micros?: number };
    expect(body.timestamp_micros).not.toBe(futureMs * 1000);
    expect(body.timestamp_micros!).toBeLessThanOrEqual(Date.now() * 1000);
  });

  it("reissues a fresh token when a valid token minted for a different origin is presented (multi-origin installs)", async () => {
    const tokenForOtherAllowedOrigin = await mintToken("https://other-allowed-origin.example.com", TOKEN_SECRET);
    const { handler, waitForForward } = await makeHandler(mockServer, {
      allowedOrigins: [ORIGIN, "https://other-allowed-origin.example.com"],
    });
    // Simulates withGa4Token's reissue logic directly, since that's where
    // the fix lives: presenting a token minted for a different origin must
    // NOT be reused for this one.
    const { reissueTokenIfNeeded } = await import("./token.js");
    const { token, reissued } = await reissueTokenIfNeeded(tokenForOtherAllowedOrigin, ORIGIN, TOKEN_SECRET);
    expect(reissued).toBe(true);

    const res = await handler(
      request({ events: [makeEvent()], consent: grantedConsent() }, { origin: ORIGIN, cookie: `${TOKEN_COOKIE_NAME}=${token}` }),
    );
    await waitForForward();
    expect(res.status).toBe(200);
  });

  describe("event_id validation", () => {
    it("rejects and does not forward an event with a missing event_id", async () => {
      const { handler, waitForForward } = await makeHandler(mockServer);
      await handler(
        request(
          { events: [{ event_id: "", name: "page_view", params: {} }], consent: grantedConsent() },
          { origin: ORIGIN, cookie: await tokenCookie() },
        ),
      );
      await waitForForward();
      expect(mockServer.requests).toHaveLength(0);
    });
  });

  describe("MP payload protocol conformance", () => {
    it("emits a numeric ga_session_id (GA4 requires ^\\d+$, not a UUID)", async () => {
      const { handler, waitForForward } = await makeHandler(mockServer);
      await handler(
        request({ events: [makeEvent()], consent: grantedConsent() }, { origin: ORIGIN, cookie: await tokenCookie() }),
      );
      await waitForForward();
      const body = mockServer.requests[0]?.body as { events: Array<{ params: Record<string, unknown> }> };
      expect(String(body.events[0]?.params.ga_session_id)).toMatch(/^\d+$/);
    });

    it("forwards ad_user_data/ad_personalization consent to MP", async () => {
      const { handler, waitForForward } = await makeHandler(mockServer);
      await handler(
        request({ events: [makeEvent()], consent: grantedConsent() }, { origin: ORIGIN, cookie: await tokenCookie() }),
      );
      await waitForForward();
      const body = mockServer.requests[0]?.body as { consent?: Record<string, string> };
      expect(body.consent).toEqual({ ad_user_data: "GRANTED", ad_personalization: "GRANTED" });
    });

    it("sends Content-Type: application/json to MP", async () => {
      const { handler, waitForForward } = await makeHandler(mockServer);
      await handler(
        request({ events: [makeEvent()], consent: grantedConsent() }, { origin: ORIGIN, cookie: await tokenCookie() }),
      );
      await waitForForward();
      expect(mockServer.requests[0]?.headers["content-type"]).toBe("application/json");
    });

    it("AC6b/AC12: a replay carries timestamp_micros derived from capture time, not flush time", async () => {
      const capturedAt = Date.now() - 60 * 60 * 1000; // captured an hour ago
      const signed = await signCaptureIdentity(
        { client_id: "my-real-id", ga_session_id: "s1", ga_session_number: 1 },
        TOKEN_SECRET,
        capturedAt,
      );
      const { handler, waitForForward } = await makeHandler(mockServer);
      await handler(
        request(
          { events: [makeEvent()], consent: grantedConsent(), replay: signed },
          { origin: ORIGIN, cookie: `${await tokenCookie()}; ${CLIENT_ID_COOKIE}=v1:my-real-id` },
        ),
      );
      await waitForForward();
      const body = mockServer.requests[0]?.body as { timestamp_micros?: number };
      expect(body.timestamp_micros).toBe(capturedAt * 1000);
    });
  });

  describe("dedupe fail-open (live) vs fail-closed (replay)", () => {
    function throwingStore(): UpstashRedisLike {
      return {
        incr: async () => 1,
        pexpire: async () => 1,
        get: async () => null,
        set: async () => {
          throw new Error("store unreachable");
        },
        del: async () => 0,
      };
    }

    it("forwards a fresh live event when the dedupe store is unreachable (fails open)", async () => {
      const { handler, waitForForward } = await makeHandler(mockServer, { store: new UpstashStore(throwingStore()) });
      await handler(
        request({ events: [makeEvent()], consent: grantedConsent() }, { origin: ORIGIN, cookie: await tokenCookie() }),
      );
      await waitForForward();
      expect(mockServer.requests).toHaveLength(1);
    });

    it("releases the dedupe mark when the deferred MP delivery itself fails, so the client's own retry can succeed", async () => {
      // A prior version marked dedupe BEFORE the deferred (after()) MP
      // send, with no rollback on failure — a network-level failure
      // reaching MP (not an MP rejection, which the docs say never
      // happens) meant the event was never really delivered despite the
      // response already saying 200, and the client's natural retry with
      // the same event_id got silently deduped forever (codex critic
      // review round 4, reproduced live).
      const store = new InMemoryStore();
      const event = makeEvent();
      const cookie = await tokenCookie();

      // First attempt: point at an address nothing is listening on, so
      // the deferred sendToMp() call itself throws (network failure).
      const { handler: failingHandler, waitForForward: waitFirst } = await makeHandler(mockServer, {
        store,
        endpointBaseOverride: "http://127.0.0.1:1",
      });
      await failingHandler(request({ events: [event], consent: grantedConsent() }, { origin: ORIGIN, cookie }));
      await waitFirst();
      expect(mockServer.requests).toHaveLength(0); // never reached the (real) mock server at all

      // Second attempt (the client's own retry, same event_id): now
      // pointed at the real mock server — must NOT be treated as a
      // duplicate, since the first attempt never actually delivered.
      const { handler: workingHandler, waitForForward: waitSecond } = await makeHandler(mockServer, { store });
      await workingHandler(request({ events: [event], consent: grantedConsent() }, { origin: ORIGIN, cookie }));
      await waitSecond();
      expect(mockServer.requests).toHaveLength(1);
    });

    it("drops a replayed event when the dedupe store is unreachable (fails closed)", async () => {
      const signed = await signCaptureIdentity(
        { client_id: "my-real-id", ga_session_id: "s1", ga_session_number: 1 },
        TOKEN_SECRET,
      );
      const { handler, waitForForward } = await makeHandler(mockServer, { store: new UpstashStore(throwingStore()) });
      await handler(
        request(
          { events: [makeEvent()], consent: grantedConsent(), replay: signed },
          { origin: ORIGIN, cookie: `${await tokenCookie()}; ${CLIENT_ID_COOKIE}=v1:my-real-id` },
        ),
      );
      await waitForForward();
      expect(mockServer.requests).toHaveLength(0);
    });
  });

  it("config.enabled:false short-circuits with an {enabled:false} body and no MP call", async () => {
    const { handler, waitForForward } = await makeHandler(mockServer, { enabled: false });
    const res = await handler(
      request({ events: [makeEvent()], consent: grantedConsent() }, { origin: ORIGIN, cookie: await tokenCookie() }),
    );
    await waitForForward();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(false);
    expect(mockServer.requests).toHaveLength(0);
  });
});

function grantedConsent() {
  return {
    ad_storage: "granted" as const,
    ad_user_data: "granted" as const,
    ad_personalization: "granted" as const,
    analytics_storage: "granted" as const,
  };
}

function deniedConsent() {
  return {
    ad_storage: "denied" as const,
    ad_user_data: "denied" as const,
    ad_personalization: "denied" as const,
    analytics_storage: "denied" as const,
  };
}
