# @gtmss/ga4-relay

## 0.1.1

### Patch Changes

- 26c805e: Fix `buildMpPayload` sending a redundant `session_id` event param alongside `ga_session_id`, which a live GA4 debug/mp/collect check flagged as `NAME_DUPLICATED` (GA4 canonicalizes `ga_session_id` to the same internal session field). Only `ga_session_id`/`ga_session_number`/`engagement_time_msec` are sent now.
- 26c805e: Fix `GET /ga4-relay/ga4-sw.js`-style SW routes 500ing in both `next dev` and production: the documented `createRequire(import.meta.url).resolve("@gtmss/ga4-relay/sw-script")` pattern is intercepted by Next.js's Route Handler bundling and never returns a real filesystem path. Added `loadBundledSwScript` at a new `@gtmss/ga4-relay/server/sw-script-loader` subpath — pass it as `ServiceWorkerConfig.loadScriptSource` instead of hand-rolling a loader. Built as a separate bundle from `./server` so its `node:fs` usage can never leak into an Edge middleware bundle that also imports `withGa4Token`. Live-browser-confirmed via new Playwright e2e specs (AC14/AC16/AC27).

## 0.1.0

### Minor Changes

- Initial public release — GA4 Measurement Protocol v2 relay for Next.js/Vercel with server-side cookie/consent handling, dedupe, retry-backed client SDK, and an offline-capable service worker.
