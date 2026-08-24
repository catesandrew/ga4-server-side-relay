# M0.2 — SW beacon-capture spike

**Status: blocked in this environment.** Requires launching real cross-browser instances (Chromium/Firefox/WebKit) with a live service worker and asserting whether the SW's `fetch` handler observes an outgoing `fetch(keepalive)`/`sendBeacon` call during page unload. This environment has no Playwright browser binaries installed and no ability to reliably simulate real unload timing across three engines in this pass.

**What this blocks:** deciding whether the service worker can be promoted from retry-only to a primary capture layer (Pre-mortem #1).

**Default assumption taken in its absence** (per plan Pre-mortem #1 and Requirements Summary): the SW's role **defaults to retry-only** — queued from the main thread on `fetch`/`sendBeacon` failure or offline detection, never assumed to reliably intercept unload-time beacons. This is the safe default and is what US-016 implements. Promotion to a capture role remains gated behind this spike passing, not assumed.

**To unblock:** install Playwright browser binaries (`pnpm exec playwright install`) and run the standing regression test referenced in the plan's Verification Steps once a target environment supports launching real browsers.

**Update:** Chromium browser binaries are now installed and launchable in this environment (see `docs/spikes/playwright-browser-e2e.md`, updated in the same pass as this note). That doc's own AC14/AC16/AC27 e2e specs are a different question (SW registration/coexistence/kill-switch) and were not extended to cover beacon/fetch(keepalive) capture during unload — this spike's own "To unblock" steps (a dedicated beacon-capture regression test, ideally cross-browser) were not attempted here. Verdict below is unchanged.
