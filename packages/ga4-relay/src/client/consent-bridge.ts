import type { ConsentSignal } from "../shared/event.js";
import { getConfigValue, setConfigValue } from "./queue.js";

/**
 * Documented contract (plan step 1.3): the host site's CMP integration
 * must set `window.__ga4RelayConsent` to the current Consent Mode v2
 * signal and dispatch a `ga4-relay:consent` CustomEvent with the new
 * signal in `detail` whenever consent changes. This module only
 * *consumes* that contract — it does not own producing correct signals.
 *
 * Reads via `globalThis` rather than `window` so this module can also be
 * imported from the service worker's flush path (sw/index.ts -> flush.ts),
 * where no `window` global exists — `globalThis`/`self` resolves in both
 * a page context and a worker context. The synchronous globalThis read is
 * the main-thread fast path only, though: the service worker has its own
 * separate `self`, so `window.__ga4RelayConsent` never reaches it. Whoever
 * calls `persistConsent` (client-sdk.ts, on init and on every change) is
 * what makes consent visible to the SW too, via the shared IndexedDB
 * config store (see queue.ts) — `resolveConsent` below is the
 * realm-agnostic read flush.ts actually uses.
 */
interface Ga4RelayGlobal {
  __ga4RelayConsent?: ConsentSignal;
  addEventListener?: (type: string, listener: (event: Event) => void) => void;
  removeEventListener?: (type: string, listener: (event: Event) => void) => void;
}

function relayGlobal(): Ga4RelayGlobal {
  return globalThis as unknown as Ga4RelayGlobal;
}

export function getCurrentConsent(): ConsentSignal | undefined {
  return relayGlobal().__ga4RelayConsent;
}

export function isCurrentlyDenied(): boolean {
  const consent = getCurrentConsent();
  return !consent || consent.analytics_storage !== "granted";
}

export function onConsentChange(cb: (consent: ConsentSignal) => void): () => void {
  const target = relayGlobal();
  if (!target.addEventListener) return () => {};
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<ConsentSignal>).detail;
    if (detail) cb(detail);
  };
  target.addEventListener("ga4-relay:consent", listener);
  return () => target.removeEventListener?.("ga4-relay:consent", listener);
}

/** Persists consent to the shared IndexedDB config store so the SW realm can read it too. */
export async function persistConsent(consent: ConsentSignal): Promise<void> {
  await setConfigValue("consent", consent);
}

/**
 * Realm-agnostic consent resolution: tries the synchronous globalThis read
 * first (works on the main thread without an IndexedDB round trip), then
 * falls back to the persisted value (works inside the service worker,
 * where globalThis.__ga4RelayConsent is never set). This is the SAME value
 * flush.ts must both gate on and send in the POST body — a prior version
 * resolved it once for the gate check but then built each request body
 * from the always-undefined-in-SW-realm synchronous read, so a granted
 * replay from the SW still posted `consent: undefined` and the server's
 * own default-deny then silently discarded it (codex critic review round 2,
 * reproduced live).
 */
export async function resolveConsent(): Promise<ConsentSignal | undefined> {
  const inline = getCurrentConsent();
  if (inline) return inline;
  return getConfigValue("consent");
}
