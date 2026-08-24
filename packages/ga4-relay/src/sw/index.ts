/// <reference lib="webworker" />
import { flushQueue } from "../client/flush.js";
import { getConfigValue } from "../client/queue.js";

declare const self: ServiceWorkerGlobalScope;

const SYNC_TAG = "ga4-relay-flush";
// In-memory fast path only — the durable source of truth is the shared
// IndexedDB config store (queue.ts), read below on every sync event. A
// service worker instance can be evicted and later woken directly by a
// `sync` event without re-receiving the page's postMessage in its current
// lifetime, so relying on this variable alone silently no-ops every flush
// after the first eviction (codex critic review).
let collectUrlFastPath: string | null = null;

// SW's role is retry/delivery resilience only, never primary event
// capture (Pre-mortem #1) — no fetch handler is registered here, so the
// host site's own requests are always untouched, including analytics
// beacons sent directly by the main thread's transport chain.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event: ExtendableMessageEvent) => {
  const data = event.data as { type?: string; collectUrl?: string } | undefined;
  if (data?.type === "ga4-relay:init" && data.collectUrl) {
    collectUrlFastPath = data.collectUrl;
  }
  // Secondary kill-switch path (AC28's primary path is main-thread
  // unregister(); this activate/message-driven check is the fallback that
  // does not depend on `activate` re-running on an unchanged script).
  if (data?.type === "ga4-relay:disabled") {
    void self.registration.unregister();
  }
});

self.addEventListener("sync", (event: SyncEvent) => {
  if (event.tag !== SYNC_TAG) return;
  event.waitUntil(
    (async () => {
      const collectUrl = collectUrlFastPath ?? (await getConfigValue("collectUrl"));
      if (!collectUrl) return; // never initialized in this worker or the page — nothing to flush against
      await flushQueue({ collectUrl, canRefreshToken: false });
    })(),
  );
});
