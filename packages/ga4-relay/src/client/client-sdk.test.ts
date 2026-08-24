// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGa4Client } from "./client-sdk.js";
import { purgeAll } from "./queue.js";

const COLLECT_URL = "https://relay.example.com/collect";

function grant() {
  (window as unknown as { __ga4RelayConsent: unknown }).__ga4RelayConsent = {
    ad_storage: "granted",
    ad_user_data: "granted",
    ad_personalization: "granted",
    analytics_storage: "granted",
  };
}

describe("client-sdk.ts", () => {
  beforeEach(async () => {
    await purgeAll();
    grant();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    (window as unknown as { __ga4RelayConsent?: unknown }).__ga4RelayConsent = undefined;
  });

  it("bootstraps identity via fetch(keepalive) on the first track() call, not sendBeacon", async () => {
    const sendBeacon = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, sendBeacon, serviceWorker: undefined });
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ client_id: "cid", ga_session_id: "sid", ga_session_number: 1, issued_at: 1, signature: "sig" }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const client = createGa4Client({ collectUrl: COLLECT_URL });
    client.track({ event_id: "e1", name: "page_view", params: {} });
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchSpy).toHaveBeenCalledWith(COLLECT_URL, expect.objectContaining({ keepalive: true }));
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("uses sendBeacon for subsequent events once identity is cached", async () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { ...navigator, sendBeacon, serviceWorker: undefined });
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ client_id: "cid", ga_session_id: "sid", ga_session_number: 1, issued_at: 1, signature: "sig" }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const client = createGa4Client({ collectUrl: COLLECT_URL });
    client.track({ event_id: "e1", name: "page_view", params: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    client.track({ event_id: "e2", name: "click", params: {} });
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon).toHaveBeenCalledWith(COLLECT_URL, expect.any(String));
  });

  it("applies the kill switch (via the SDK's own in-flight registration) when the collect response reports {enabled:false}", async () => {
    const unregister = vi.fn();
    const registration = { active: { postMessage: vi.fn() }, unregister };
    const register = vi.fn().mockResolvedValue(registration);
    vi.stubGlobal("navigator", { ...navigator, sendBeacon: vi.fn(), serviceWorker: { register } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ enabled: false }), { status: 200 })));

    const client = createGa4Client({ collectUrl: COLLECT_URL, swScriptUrl: "/sw.js", swScope: "/ga4-relay/" });
    client.track({ event_id: "e1", name: "page_view", params: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/ga4-relay/" });
    expect(unregister).toHaveBeenCalled();
  });

  it("buffers events fired while the identity bootstrap is still in flight, then sends them once it resolves", async () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { ...navigator, sendBeacon, serviceWorker: undefined });
    let resolveFetch: (res: Response) => void;
    const bootstrapPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(bootstrapPromise));

    const client = createGa4Client({ collectUrl: COLLECT_URL });
    client.track({ event_id: "e1", name: "page_view", params: {} }); // triggers bootstrap, not yet resolved
    client.track({ event_id: "e2", name: "click", params: {} }); // must be buffered, not dropped
    client.track({ event_id: "e3", name: "click", params: {} }); // also buffered

    resolveFetch!(
      new Response(
        JSON.stringify({ client_id: "cid", ga_session_id: "sid", ga_session_number: 1, issued_at: 1, signature: "sig" }),
        { status: 200 },
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // e1 went out as part of the bootstrap fetch itself; e2/e3 must have
    // been sent afterward via sendBeacon, not silently discarded.
    expect(sendBeacon).toHaveBeenCalledTimes(2);
  });

  it("restores the FIRST event to the buffer (not just later-buffered ones) when the bootstrap call fails, and sends it once retried", async () => {
    vi.stubGlobal("navigator", { ...navigator, sendBeacon: vi.fn().mockReturnValue(true), serviceWorker: undefined });
    const fetchSpy = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline")) // bootstrap attempt fails — firstEvent must not be lost
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ client_id: "cid", ga_session_id: "sid", ga_session_number: 1, issued_at: 1, signature: "sig" }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchSpy);

    const client = createGa4Client({ collectUrl: COLLECT_URL });
    client.track({ event_id: "first-lost", name: "page_view", params: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Retry bootstrap (simulating the 'online' listener's call) — the
    // previously-shifted-out first event must still be the one retried.
    window.dispatchEvent(new Event("online"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const secondCallBody = JSON.parse(fetchSpy.mock.calls[1][1].body as string);
    expect(secondCallBody.events[0].event_id).toBe("first-lost");
  });

  it("keeps (does not drop) a bootstrap event when its 204 response reflects stale (since-changed) denial, and sends it once an external trigger fires", async () => {
    // Classified as "retry-later" (see BootstrapOutcome), so per the
    // round-5 storm fix it does NOT auto-retry immediately — it waits for
    // the next external trigger (another track() call or 'online'), same
    // as any other retry-later outcome. What must NOT happen is the event
    // being silently wiped, which is what the round-4 fix addressed.
    vi.stubGlobal("navigator", { ...navigator, sendBeacon: vi.fn().mockReturnValue(true), serviceWorker: undefined });
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 })) // consent was denied when this request was SENT
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ client_id: "cid", ga_session_id: "sid", ga_session_number: 1, issued_at: 1, signature: "sig" }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchSpy);

    // Consent starts denied for the first attempt...
    (window as unknown as { __ga4RelayConsent: unknown }).__ga4RelayConsent = {
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: "denied",
    };
    const client = createGa4Client({ collectUrl: COLLECT_URL });
    client.track({ event_id: "consent-flip-during-bootstrap", name: "page_view", params: {} });
    // ...then flips to granted before the 204 response is processed.
    grant();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchSpy).toHaveBeenCalledTimes(1); // not auto-retried yet — waiting for an external trigger

    // External trigger: another track() call.
    client.track({ event_id: "second-event", name: "click", params: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const secondCallBody = JSON.parse(fetchSpy.mock.calls[1][1].body as string);
    expect(secondCallBody.events[0].event_id).toBe("consent-flip-during-bootstrap"); // the retried event, not dropped
  });

  it("does not lose a track() call that arrives WHILE the bootstrap attempt is still in flight (not just after it settles)", async () => {
    // The round-6 storm fix made retry-later wait for an external
    // trigger — but track() (and 'online', tested separately below)
    // called startBootstrap() directly, which no-ops while
    // bootstrapInFlight is true. A trigger arriving DURING the failing
    // request, not after it settled, was silently dropped with no latch
    // to remember it happened (codex critic review round 6, reproduced
    // live with both triggers).
    // sendBeacon succeeds so the drained "second-during-inflight" event
    // (once identity is established by the retry) goes out via beacon,
    // not a third fetch call — keeping this test focused on the bootstrap
    // fetch count specifically.
    vi.stubGlobal("navigator", { ...navigator, sendBeacon: vi.fn().mockReturnValue(true), serviceWorker: undefined });
    let rejectFirst: (err: Error) => void;
    const firstFetch = new Promise<Response>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const fetchSpy = vi
      .fn()
      .mockReturnValueOnce(firstFetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ client_id: "cid", ga_session_id: "sid", ga_session_number: 1, issued_at: 1, signature: "sig" }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchSpy);

    const client = createGa4Client({ collectUrl: COLLECT_URL });
    client.track({ event_id: "first", name: "page_view", params: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));

    client.track({ event_id: "second-during-inflight", name: "click", params: {} }); // arrives WHILE first is still pending
    await new Promise((resolve) => setTimeout(resolve, 0));

    rejectFirst!(new Error("network failure"));
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    // The latched wake-up must produce exactly one follow-up bootstrap
    // attempt — not zero (lost) and not an unbounded storm.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does not lose an 'online' event that arrives WHILE the bootstrap attempt is still in flight", async () => {
    vi.stubGlobal("navigator", { ...navigator, sendBeacon: vi.fn(), serviceWorker: undefined });
    let rejectFirst: (err: Error) => void;
    const firstFetch = new Promise<Response>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const fetchSpy = vi
      .fn()
      .mockReturnValueOnce(firstFetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ client_id: "cid", ga_session_id: "sid", ga_session_number: 1, issued_at: 1, signature: "sig" }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchSpy);

    const client = createGa4Client({ collectUrl: COLLECT_URL });
    client.track({ event_id: "first", name: "page_view", params: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));

    window.dispatchEvent(new Event("online")); // arrives WHILE first is still pending
    await new Promise((resolve) => setTimeout(resolve, 0));

    rejectFirst!(new Error("network failure"));
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry-storm the bootstrap fetch when it fails with a retryable/network error — waits for 'online' or a new track() call", async () => {
    // A prior version's fix for the "buffered events stall" bug (below)
    // over-corrected: it recursed startBootstrap() unconditionally
    // whenever no identity existed and events remained queued, which
    // included the retry-later case — so a single failed bootstrap call
    // (network down, or a stream of 5xx) triggered an unbounded tight
    // retry loop with zero backoff (codex critic review round 5,
    // reproduced live: 21 fetches from one track() call, no external
    // trigger in between).
    vi.stubGlobal("navigator", { ...navigator, sendBeacon: vi.fn(), serviceWorker: undefined });
    const fetchSpy = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchSpy);

    const client = createGa4Client({ collectUrl: COLLECT_URL });
    client.track({ event_id: "retry-storm-check", name: "page_view", params: {} });

    // Give any runaway recursive retries plenty of ticks to happen if the
    // bug is present — a fixed implementation makes exactly one attempt.
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("automatically retries bootstrap for events buffered WHILE the first (permanently-rejected) attempt was still in flight", async () => {
    // Distinct from the "poison the buffer" test below: here event2 is
    // pushed BEFORE the first bootstrap resolves, so drainPendingEvents()
    // (which requires an established identity) can't be what delivers it —
    // only the finally-block's automatic re-attempt can (codex critic
    // review round 4).
    vi.stubGlobal("navigator", { ...navigator, sendBeacon: vi.fn().mockReturnValue(true), serviceWorker: undefined });
    let resolveFirst: (res: Response) => void;
    const firstFetch = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchSpy = vi
      .fn()
      .mockReturnValueOnce(firstFetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ client_id: "cid", ga_session_id: "sid", ga_session_number: 1, issued_at: 1, signature: "sig" }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchSpy);

    const client = createGa4Client({ collectUrl: COLLECT_URL });
    client.track({ event_id: "permanently-invalid", name: "page_view", params: {} });
    client.track({ event_id: "buffered-during-inflight", name: "click", params: {} }); // pushed before bootstrap resolves

    resolveFirst!(new Response(JSON.stringify({ retryable: false }), { status: 400 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const secondCallBody = JSON.parse(fetchSpy.mock.calls[1][1].body as string);
    expect(secondCallBody.events[0].event_id).toBe("buffered-during-inflight");
  });

  it("does not let a PERMANENTLY-rejected bootstrap event poison the buffer for later valid events", async () => {
    vi.stubGlobal("navigator", { ...navigator, sendBeacon: vi.fn().mockReturnValue(true), serviceWorker: undefined });
    const fetchSpy = vi
      .fn()
      // First bootstrap attempt: the event itself is permanently invalid (e.g. oversized).
      .mockResolvedValueOnce(new Response(JSON.stringify({ retryable: false }), { status: 400 }))
      // Bootstrap retry (now for the SECOND, valid event) succeeds.
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ client_id: "cid", ga_session_id: "sid", ga_session_number: 1, issued_at: 1, signature: "sig" }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchSpy);

    const client = createGa4Client({ collectUrl: COLLECT_URL });
    client.track({ event_id: "permanently-invalid", name: "page_view", params: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    client.track({ event_id: "valid-later-event", name: "click", params: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The permanent failure must not still be sitting at the front of the
    // buffer blocking everything behind it — the second bootstrap attempt
    // must be for the valid event, not a retry of the poisoned one.
    const secondCallBody = JSON.parse(fetchSpy.mock.calls[1][1].body as string);
    expect(secondCallBody.events[0].event_id).toBe("valid-later-event");
  });

  it("queues a live event for retry when the fetch fallback gets a resolved-but-retryable response (not just a network rejection)", async () => {
    vi.stubGlobal("navigator", { ...navigator, sendBeacon: vi.fn().mockReturnValue(false), serviceWorker: undefined });
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ client_id: "cid", ga_session_id: "sid", ga_session_number: 1, issued_at: 1, signature: "sig" }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ retryable: true }), { status: 503 }));
    vi.stubGlobal("fetch", fetchSpy);

    const client = createGa4Client({ collectUrl: COLLECT_URL });
    client.track({ event_id: "e1", name: "page_view", params: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    client.track({ event_id: "e2", name: "click", params: {} }); // sendBeacon returns false -> fetch fallback -> 503
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const { getAll } = await import("./queue.js");
    const queued = await getAll();
    expect(queued.some((r) => r.event.event_id === "e2")).toBe(true);
  });

  it("does not re-enqueue an event whose in-flight fallback resolves AFTER consent has since been withdrawn", async () => {
    // A prior version could have an in-flight fallback fetch resolve
    // "needs retry" after the user withdrew consent (which purges the
    // queue) — re-adding an identity-bearing record to the now-empty
    // queue, undoing the purge (codex critic review round 4).
    vi.stubGlobal("navigator", { ...navigator, sendBeacon: vi.fn().mockReturnValue(false), serviceWorker: undefined });
    let resolveFallback: (res: Response) => void;
    const fallbackFetch = new Promise<Response>((resolve) => {
      resolveFallback = resolve;
    });
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ client_id: "cid", ga_session_id: "sid", ga_session_number: 1, issued_at: 1, signature: "sig" }),
          { status: 200 },
        ),
      )
      .mockReturnValueOnce(fallbackFetch);
    vi.stubGlobal("fetch", fetchSpy);

    const client = createGa4Client({ collectUrl: COLLECT_URL });
    client.track({ event_id: "e1", name: "page_view", params: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    client.track({ event_id: "e2", name: "click", params: {} }); // sendBeacon fails -> fetch fallback, left pending

    // Consent withdrawn while the fallback is still in flight.
    (window as unknown as { __ga4RelayConsent: unknown }).__ga4RelayConsent = {
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: "denied",
    };

    resolveFallback!(new Response(JSON.stringify({ retryable: true }), { status: 503 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const { getAll } = await import("./queue.js");
    expect(await getAll()).toHaveLength(0);
  });

  it("does not track events while the page is prerendering", async () => {
    Object.defineProperty(document, "prerendering", { value: true, configurable: true });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("navigator", { ...navigator, sendBeacon: vi.fn(), serviceWorker: undefined });

    const client = createGa4Client({ collectUrl: COLLECT_URL });
    client.track({ event_id: "e1", name: "page_view", params: {} });
    await Promise.resolve();

    expect(fetchSpy).not.toHaveBeenCalled();
    Object.defineProperty(document, "prerendering", { value: false, configurable: true });
  });
});
