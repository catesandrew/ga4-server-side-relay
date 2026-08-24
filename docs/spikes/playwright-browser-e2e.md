# Playwright browser e2e — blocked in this environment

**Status: blocked.** `pnpm exec playwright install chromium` was attempted and did not complete — the browser binary cache directory (`~/Library/Caches/ms-playwright/`) exists but is 0 bytes, confirming no network access is available in this sandbox to download browser binaries. This is the same class of environment constraint documented in `docs/spikes/sw-beacon-capture.md`.

**What this blocks:** any test that requires a real registered service worker in an actual browser — specifically AC14 (coexistence with an existing SW already controlling the page — a real browser registration-conflict behavior, not something this package's code decides), and full end-to-end registration/activation flows for AC16/AC27/AC28.

**What is NOT blocked, and is covered instead:**
- AC15 (`Cache-Control: no-cache`) and AC27 (`Service-Worker-Allowed` header matching the configured scope) — verified directly against the `Response` object returned by `createServiceWorkerHandler()` in `create-service-worker-handler.test.ts`, without needing a browser (these are just HTTP response headers).
- AC28's core logic (main-thread `registration.unregister()` call on a disabled kill switch) — verified in `client-sdk.test.ts` by mocking `navigator.serviceWorker.getRegistration`, which exercises the actual decision logic without needing a real SW registration.
- The SW script's own `sync`/`message`/`activate` handlers (`src/sw/index.ts`) — type-checked under the WebWorker lib (`tsconfig.sw.json`) and reviewed, but not executed in a real worker context here.

**To unblock:** run `pnpm exec playwright install chromium` in an environment with outbound network access, then add e2e specs under `packages/ga4-relay/e2e/` (the `playwright.config.ts` at the repo root is already wired to `apps/demo` as the target) covering: registering the resilience SW alongside a second test SW already controlling the page and asserting neither is deregistered (AC14); registering with a nested scope and asserting `registration.scope` matches (AC27, browser-side confirmation of the header-level test already in place); and a full kill-switch flow asserting the site continues functioning after `unregister()` (AC16).
