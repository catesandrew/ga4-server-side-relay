// Trivial no-op service worker used ONLY by packages/ga4-relay/e2e specs
// (AC14 coexistence) to simulate a host site's own pre-existing service
// worker already controlling the page at root scope, alongside the
// resilience SW registered at the nested /ga4-relay/ scope. Does nothing
// else — no fetch handler, no caching — so it can never interfere with any
// other test or real page behavior.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
