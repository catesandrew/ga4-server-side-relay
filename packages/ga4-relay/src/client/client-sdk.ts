import { enqueue, purgeAll, setConfigValue } from "./queue.js";
import { flushQueue } from "./flush.js";
import { classifyCollectResponse } from "./classify-response.js";
import { getCurrentConsent, isCurrentlyDenied, onConsentChange, persistConsent } from "./consent-bridge.js";
import type { CollectRequestBody, Ga4Event, SignedCaptureIdentity } from "../shared/event.js";

export interface Ga4ClientOptions {
  collectUrl: string;
  /** URL of the served SW script (create-service-worker-handler.ts route). Omit to skip SW registration entirely. */
  swScriptUrl?: string;
  /**
   * Scope for the resilience SW. Omit to let the browser use its natural
   * default (the SW script URL's own directory) — the safest choice, since
   * it can never widen beyond what's already true and so can never take
   * over a host site's existing service worker at a broader scope (AC14).
   * Only pass this if you've verified there's no conflicting host SW.
   */
  swScope?: string;
}

interface DisabledBody {
  enabled: false;
}

const SYNC_TAG = "ga4-relay-flush";

export function createGa4Client(options: Ga4ClientOptions) {
  let cachedIdentity: SignedCaptureIdentity | null = null;
  let relayDisabled = false;
  let bootstrapInFlight = false;
  let bootstrapWakeupRequested = false;
  const pendingEvents: Ga4Event[] = [];
  let swRegistration: ServiceWorkerRegistration | undefined;
  let swRegistrationPromise: Promise<ServiceWorkerRegistration | undefined> | null = null;

  async function requestBackgroundSync(): Promise<void> {
    if (!swRegistration || !("sync" in swRegistration)) return;
    try {
      await (
        swRegistration as ServiceWorkerRegistration & { sync: { register(tag: string): Promise<void> } }
      ).sync.register(SYNC_TAG);
    } catch {
      // Background Sync unsupported (non-Chromium) — main-thread online/page-load flush still covers this.
    }
  }

  async function enqueueEvent(event: Ga4Event, identity: SignedCaptureIdentity): Promise<void> {
    // An in-flight send can resolve to "needs retry" AFTER the user has
    // since withdrawn consent — without this check, that resolution would
    // re-add an identity-bearing record to a queue the AC32 purge had just
    // emptied moments earlier, undoing it (codex critic review round 4,
    // reproduced live).
    if (isCurrentlyDenied()) return;
    await enqueue({
      schemaVersion: 1,
      event,
      capturedAt: Date.now(),
      identity,
      capturedConsentGranted: !isCurrentlyDenied(),
    });
    // Registered at enqueue time, not at SDK startup — a Background Sync tag
    // only matters once there's actually something to flush (codex critic
    // review: registering it unconditionally at init doesn't reflect
    // whether anything is queued).
    void requestBackgroundSync();
  }

  /**
   * Serializes the bootstrap fetch across browser tabs/contexts sharing
   * this origin, when the Web Locks API is available. Without this, two
   * tabs opening simultaneously with no existing cookie each mint their
   * own client_id server-side and race their Set-Cookie responses — the
   * losing tab's in-memory cached identity then mismatches the cookie the
   * browser actually kept, and every subsequent replay from that tab gets
   * rejected (codex critic review round 4, reproduced live: two distinct
   * IDs, then a 400 client-id-mismatch from the losing tab). Serializing
   * the fetch means the second tab's request is only ever sent after the
   * first's response has already been applied by the browser, so it
   * naturally carries the now-set cookie and the server reuses the
   * existing identity instead of minting a second one. No lock support
   * (e.g. older Safari): falls back to running unserialized, same as
   * before — an accepted, narrower-than-before race window.
   */
  async function withBootstrapLock<T>(fn: () => Promise<T>): Promise<T> {
    const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
    if (!locks) return fn();
    return locks.request("ga4-relay-bootstrap", fn);
  }

  /**
   * Explicit outcome instead of a boolean: "delivered" and "permanent-drop"
   * both mean firstEvent is done with (no identity, nothing to retry), but
   * they need DIFFERENT recursion behavior in startBootstrap's finally
   * block below — "permanent-drop" should immediately try the NEXT
   * buffered event (if any), while "retry-later" must NOT immediately
   * retry the SAME event again. A prior version collapsed this to a single
   * boolean and unconditionally recursed whenever no identity existed and
   * events remained buffered — which included the retry-later case, so a
   * network outage or a stream of 5xx responses produced an unbounded
   * tight retry loop with no backoff (codex critic review round 5,
   * reproduced live: 21 fetches from a single track() call with no
   * 'online' event or new track() in between).
   */
  type BootstrapOutcome = "delivered" | "permanent-drop" | "retry-later";

  async function runBootstrap(firstEvent: Ga4Event): Promise<BootstrapOutcome> {
    const body: CollectRequestBody = { events: [firstEvent], consent: getCurrentConsent() };
    try {
      // First call of a page load always uses fetch(keepalive) — its
      // response is readable, unlike sendBeacon's, and identity can only
      // be bootstrapped from a readable response.
      const res = await withBootstrapLock(() =>
        fetch(options.collectUrl, { method: "POST", body: JSON.stringify(body), keepalive: true }),
      );
      if (res.status === 200) {
        const json = (await res.json()) as SignedCaptureIdentity | DisabledBody;
        if ("enabled" in json && json.enabled === false) {
          relayDisabled = true;
          pendingEvents.length = 0;
          await applyKillSwitchViaStoredRegistration();
          return "delivered"; // nothing left to do — relay is off
        }
        cachedIdentity = json as SignedCaptureIdentity;
        return "delivered"; // delivered as part of this bootstrap call itself
      }
      if (res.status === 204) {
        // consent denied: nothing to cache, nothing queued — denied events
        // were never captured server-side, per AC6. Anything buffered
        // while this resolved is dropped for the same reason — BUT only
        // if consent is STILL denied right now: this 204 reflects consent
        // at the moment the bootstrap request was SENT, and if the user
        // granted consent while it was in flight, events queued in that
        // window are legitimately capturable and must not be silently
        // wiped by a now-stale denial response (codex critic review
        // round 4, reproduced live).
        if (isCurrentlyDenied()) {
          pendingEvents.length = 0;
          return "delivered"; // nothing to retry — genuinely denied
        }
        return "retry-later"; // consent flipped mid-flight — retry under current (granted) consent, but not in a tight loop
      }
      // Other statuses (401/429/5xx retryable vs. 400/403 permanent on the
      // bootstrap call itself) — classify the same way the flush/fallback
      // paths do. A prior version treated every non-200/204 status as
      // retryable, including permanent 400/403 rejections — restoring a
      // permanently-invalid event to the front of pendingEvents forever,
      // which then blocked every later valid event behind it (codex
      // critic review round 3, reproduced live with an oversized event).
      const classified = await classifyCollectResponse(res);
      return classified.outcome === "permanent" ? "permanent-drop" : "retry-later";
    } catch {
      // Network failure/offline on the bootstrap call: no identity yet,
      // firstEvent was never sent. Retried via a later track() call or the
      // 'online' listener — NOT immediately (see BootstrapOutcome doc
      // comment above). If the page never regains connectivity before
      // it's unloaded, it's lost — an inherent limit of an identity model
      // that requires one network round trip before anything can be
      // signed, not a bug to paper over.
      return "retry-later";
    }
  }

  function drainPendingEvents(): void {
    if (!cachedIdentity || pendingEvents.length === 0) return;
    const drained = pendingEvents.splice(0, pendingEvents.length);
    for (const event of drained) void sendWithCachedIdentity(event);
  }

  /**
   * External triggers (track(), the 'online' listener) call this, not
   * startBootstrap() directly. If an attempt is already in flight, the
   * trigger is latched rather than dropped — a prior version had `track()`
   * and 'online' both call startBootstrap() directly, which no-ops while
   * `bootstrapInFlight` is true (see the guard at the top of
   * startBootstrap), silently losing that wake-up. If the in-flight
   * attempt then resolves "retry-later", nothing was left to trigger a
   * follow-up — the round-6 fix's own doc comments promised "waits for the
   * next 'online' event or track() call", but a trigger arriving DURING
   * the failing request, not after it settled, was exactly the case that
   * promise didn't cover (codex critic review round 6, reproduced live
   * with both an in-flight track() and an in-flight 'online' event).
   */
  function requestBootstrap(): void {
    if (bootstrapInFlight) {
      bootstrapWakeupRequested = true;
      return;
    }
    void startBootstrap();
  }

  async function startBootstrap(): Promise<void> {
    if (bootstrapInFlight || pendingEvents.length === 0) return;
    bootstrapInFlight = true;
    const firstEvent = pendingEvents.shift() as Ga4Event;
    let outcome: BootstrapOutcome;
    try {
      outcome = await runBootstrap(firstEvent);
      if (outcome === "retry-later") pendingEvents.unshift(firstEvent); // restore to the front — never silently lost
    } finally {
      bootstrapInFlight = false;
    }
    // Consume the latch here, exactly once — a wake-up received during
    // THIS attempt earns exactly one follow-up attempt below, never an
    // open-ended one, so a run of failures can't self-recurse into a
    // storm the way the round-5 bug did.
    const hadWakeup = bootstrapWakeupRequested;
    bootstrapWakeupRequested = false;
    if (cachedIdentity) {
      drainPendingEvents();
    } else if (pendingEvents.length > 0 && !relayDisabled && (outcome === "permanent-drop" || hadWakeup)) {
      // Recurse when EITHER: firstEvent was PERMANENTLY dropped (genuinely
      // done with) and something else remains buffered (codex critic
      // review round 4), OR an external trigger arrived while this attempt
      // was in flight and got latched above (codex critic review round 6).
      // Deliberately NOT recursing on a bare "retry-later" with no latched
      // wake-up: that would immediately retry the SAME event with no
      // backoff, the unbounded request-storm from round 5.
      void startBootstrap();
    }
  }

  async function sendWithCachedIdentity(event: Ga4Event): Promise<void> {
    if (!cachedIdentity) return;
    const identity = cachedIdentity;
    const body: CollectRequestBody = { events: [event], consent: getCurrentConsent(), replay: identity };
    const payload = JSON.stringify(body);

    const sentViaBeacon =
      typeof navigator !== "undefined" && "sendBeacon" in navigator ? navigator.sendBeacon(options.collectUrl, payload) : false;
    if (sentViaBeacon) return; // fire-and-forget by design — unload-safe, response unreadable

    let response: Response;
    try {
      response = await fetch(options.collectUrl, { method: "POST", body: payload, keepalive: true });
    } catch {
      await enqueueEvent(event, identity); // network failure: queue for retry
      return;
    }

    // A resolved-but-non-2xx response was previously ignored outright,
    // silently dropping the event on 400/401/429/5xx (codex critic
    // review) — classify it the same way the replay/flush path does.
    const classified = await classifyCollectResponse(response);
    if (classified.outcome === "permanent" || classified.outcome === "success") return;
    await enqueueEvent(event, identity); // retryable or needs-token-refresh: queue for the flush loop
  }

  async function applyKillSwitchViaStoredRegistration(): Promise<void> {
    // Awaits the SAME in-flight registration this SDK instance kicked off,
    // rather than re-querying via getRegistration() — a prior version could
    // race register() finishing after unregister() had already run,
    // leaving a disabled relay's SW registered anyway (codex critic review).
    const registration = swRegistration ?? (await swRegistrationPromise);
    if (registration) await registration.unregister();
  }

  function waitForActive(registration: ServiceWorkerRegistration): Promise<void> {
    if (registration.active) return Promise.resolve();
    return new Promise((resolve) => {
      const worker = registration.installing ?? registration.waiting;
      if (!worker) {
        resolve();
        return;
      }
      worker.addEventListener("statechange", function onChange() {
        if (worker.state === "activated") {
          worker.removeEventListener("statechange", onChange);
          resolve();
        }
      });
    });
  }

  /**
   * AC27: registers with an explicit scope matching the served SW's
   * Service-Worker-Allowed header when swScope is provided — an omitted
   * scope lets the browser use its natural (narrowest) default instead of
   * silently forcing "/", which would risk taking over a host SW at that
   * scope (AC14).
   */
  async function registerServiceWorker(): Promise<ServiceWorkerRegistration | undefined> {
    if (!options.swScriptUrl || typeof navigator === "undefined" || !navigator.serviceWorker) return undefined;
    try {
      const registration = await navigator.serviceWorker.register(
        options.swScriptUrl,
        options.swScope ? { scope: options.swScope } : undefined,
      );
      swRegistration = registration;
      // Wait for an active worker before postMessage — right after the
      // very first install(), registration.active is commonly still null,
      // so posting to it immediately silently drops the init message
      // (codex critic review).
      await waitForActive(registration);
      registration.active?.postMessage({ type: "ga4-relay:init", collectUrl: options.collectUrl });
      return registration;
    } catch {
      // Registration failure must never break the collect path — best-effort only.
      return undefined;
    }
  }

  function track(event: Ga4Event): void {
    if (relayDisabled) return;
    if (typeof document !== "undefined" && (document as Document & { prerendering?: boolean }).prerendering) {
      return;
    }
    if (cachedIdentity) {
      void sendWithCachedIdentity(event);
      return;
    }
    pendingEvents.push(event);
    requestBootstrap();
  }

  if (typeof window !== "undefined") {
    void setConfigValue("collectUrl", options.collectUrl);
    const initialConsent = getCurrentConsent();
    if (initialConsent) void persistConsent(initialConsent);

    onConsentChange((consent) => {
      void persistConsent(consent);
      if (consent.analytics_storage !== "granted") {
        void purgeAll(); // AC32
      }
    });
    window.addEventListener("online", () => {
      void flushQueue({ collectUrl: options.collectUrl, canRefreshToken: true });
      requestBootstrap(); // retry a bootstrap that failed while offline
    });
    void flushQueue({ collectUrl: options.collectUrl, canRefreshToken: true });
    swRegistrationPromise = registerServiceWorker();
  }

  return { track };
}
