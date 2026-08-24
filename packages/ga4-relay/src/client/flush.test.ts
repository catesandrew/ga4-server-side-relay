// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushQueue } from "./flush.js";
import { enqueue, getAll, purgeAll, setConfigValue, type QueuedRecord } from "./queue.js";
import type { ConsentSignal } from "../shared/event.js";

const GLOBAL = globalThis as unknown as { __ga4RelayConsent?: ConsentSignal };

function grantConsent() {
  GLOBAL.__ga4RelayConsent = {
    ad_storage: "granted",
    ad_user_data: "granted",
    ad_personalization: "granted",
    analytics_storage: "granted",
  };
}

function denyConsent() {
  GLOBAL.__ga4RelayConsent = {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "denied",
  };
}

function record(overrides: Partial<QueuedRecord> = {}): Omit<QueuedRecord, "id"> {
  return {
    schemaVersion: 1,
    event: { event_id: crypto.randomUUID(), name: "page_view", params: {} },
    capturedAt: Date.now(),
    identity: { client_id: "abc", ga_session_id: "s1", ga_session_number: 1, issued_at: Date.now(), signature: "sig" },
    capturedConsentGranted: true,
    ...overrides,
  };
}

describe("flush.ts", () => {
  beforeEach(async () => {
    await purgeAll();
    grantConsent();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    GLOBAL.__ga4RelayConsent = undefined;
  });

  it("AC33: current-denied consent drops every queued record without sending any of them", async () => {
    await enqueue(record());
    denyConsent();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await flushQueue({ collectUrl: "https://relay.example.com/collect", canRefreshToken: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await getAll()).toHaveLength(0); // dropped, not left queued forever
  });

  it("AC13: drops an expired (>48h) record without sending it", async () => {
    const now = Date.now();
    await enqueue(record({ capturedAt: now - 49 * 60 * 60 * 1000 }));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await flushQueue({ collectUrl: "https://relay.example.com/collect", canRefreshToken: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await getAll()).toHaveLength(0);
  });

  it("removes a record on a successful (204) response", async () => {
    await enqueue(record());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await flushQueue({ collectUrl: "https://relay.example.com/collect", canRefreshToken: true });
    expect(await getAll()).toHaveLength(0);
  });

  it("AC26: drops a record on a permanent (retryable:false) rejection", async () => {
    await enqueue(record());
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ retryable: false }), { status: 400 })),
    );
    await flushQueue({ collectUrl: "https://relay.example.com/collect", canRefreshToken: true });
    expect(await getAll()).toHaveLength(0);
  });

  it("AC26: keeps a record queued on a 401 needs-token-refresh response", async () => {
    await enqueue(record());
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ retryable: "needs-token-refresh" }), { status: 401 }),
      ),
    );
    await flushQueue({ collectUrl: "https://relay.example.com/collect", canRefreshToken: false });
    expect(await getAll()).toHaveLength(1); // survives — never dropped for a credential reason alone
  });

  it("AC26: keeps a record queued on a retryable (429/5xx) response", async () => {
    await enqueue(record());
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ retryable: true, retryAfterMs: 1000 }), { status: 429 })),
    );
    await flushQueue({ collectUrl: "https://relay.example.com/collect", canRefreshToken: true });
    expect(await getAll()).toHaveLength(1);
  });

  it("keeps a record queued on a network failure", async () => {
    await enqueue(record());
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await flushQueue({ collectUrl: "https://relay.example.com/collect", canRefreshToken: true });
    expect(await getAll()).toHaveLength(1);
  });

  it("sends the SW-realm's persisted consent in the POST body, not an always-undefined synchronous read", async () => {
    // Simulates the service worker realm: no globalThis.__ga4RelayConsent
    // (that's a main-thread-only global), only the persisted IndexedDB
    // value that resolveConsent's gate check already reads.
    GLOBAL.__ga4RelayConsent = undefined;
    await setConfigValue("consent", {
      ad_storage: "granted",
      ad_user_data: "granted",
      ad_personalization: "granted",
      analytics_storage: "granted",
    });
    await enqueue(record());
    let sentBody: { consent?: unknown } | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        sentBody = JSON.parse(init.body as string);
        return Promise.resolve(new Response(null, { status: 204 }));
      }),
    );
    await flushQueue({ collectUrl: "https://relay.example.com/collect", canRefreshToken: true });
    expect(sentBody?.consent).toMatchObject({ analytics_storage: "granted" });
  });

  it("AC6b/AC12: replays the record's capture-time identity AND capturedAtMs, not fresh/identity-issuance values", async () => {
    const eventCapturedAt = Date.now() - 60 * 60 * 1000; // captured an hour ago, long after the identity was issued
    await enqueue(
      record({
        capturedAt: eventCapturedAt,
        identity: { client_id: "captured-id", ga_session_id: "captured-session", ga_session_number: 7, issued_at: 111, signature: "sig" },
      }),
    );
    let sentBody: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        sentBody = JSON.parse(init.body as string);
        return Promise.resolve(new Response(null, { status: 204 }));
      }),
    );
    await flushQueue({ collectUrl: "https://relay.example.com/collect", canRefreshToken: true });
    expect(sentBody).toMatchObject({
      replay: { client_id: "captured-id", ga_session_id: "captured-session", ga_session_number: 7 },
      capturedAtMs: eventCapturedAt,
    });
  });
});
