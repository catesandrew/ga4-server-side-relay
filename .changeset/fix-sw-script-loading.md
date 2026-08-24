---
"@gtmss/ga4-relay": patch
---

Fix `GET /ga4-relay/ga4-sw.js`-style SW routes 500ing in both `next dev` and production: the documented `createRequire(import.meta.url).resolve("@gtmss/ga4-relay/sw-script")` pattern is intercepted by Next.js's Route Handler bundling and never returns a real filesystem path. Added `loadBundledSwScript` at a new `@gtmss/ga4-relay/server/sw-script-loader` subpath — pass it as `ServiceWorkerConfig.loadScriptSource` instead of hand-rolling a loader. Built as a separate bundle from `./server` so its `node:fs` usage can never leak into an Edge middleware bundle that also imports `withGa4Token`. Live-browser-confirmed via new Playwright e2e specs (AC14/AC16/AC27).
