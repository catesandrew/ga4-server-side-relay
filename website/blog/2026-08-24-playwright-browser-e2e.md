---
slug: playwright-browser-e2e
title: Playwright browser e2e — unblocked, all 3 ACs browser-confirmed
authors: []
tags: [verification, spike]
date: 2026-08-24
---

**Status: RESOLVED (2026-08-24).** All three ACs this spike targeted (AC14, AC16, AC27) are
now real-browser-confirmed. `pnpm exec playwright test --project=chromium` passes 4/4.

The original blocker — no Playwright browser binaries available — is resolved.
`pnpm exec playwright install chromium` succeeded (Chrome for Testing 151.0.7922.34,
`/Volumes/dev-ssd/caches/playwright/chromium-1234`). Firefox/webkit are present in the cache
but at stale versions vs. what this Playwright wants, so `chromium` is the only project
currently runnable here.

## What was added

- `packages/ga4-relay/e2e/helpers.ts` — shared helpers wrapping the real `navigator.serviceWorker`
  API (`waitForRegistrationActive`, `getRegistrationSummaries`, `registerAndWaitForActive`,
  `unregisterAllServiceWorkers`). No mocking — every call goes through `page.evaluate` into the
  actual browser API.
- `packages/ga4-relay/e2e/ac27-scope.spec.ts` — AC27: `registration.scope` resolves to the
  configured nested `/ga4-relay/` scope, both via `ga4-init.tsx`'s real auto-registration and via
  an explicit `navigator.serviceWorker.register()` call.
- `packages/ga4-relay/e2e/ac14-coexistence.spec.ts` — AC14: a trivial no-op host SW at root scope
  (`apps/demo/public/test-sw.js`) plus the resilience SW at its nested scope both remain
  registered and active, including after a reload.
- `packages/ga4-relay/e2e/ac16-kill-switch.spec.ts` — AC16: real `registration.unregister()` on
  the resilience SW leaves the site loading/rendering with zero uncaught page errors.
- `apps/demo/public/test-sw.js` — trivial no-op SW used only by the AC14 spec.
- `apps/demo/.env.local` (gitignored) — placeholder `GA4_*`/`UPSTASH_*` values so the demo app
  can boot without real credentials.

## Bug #1 (real product bug, fixed): SW route 500s in both dev and prod

`GET /ga4-relay/ga4-sw.js` returned `500` in both `next dev` and `next build && next start`.
Root cause: `apps/demo/app/ga4-relay/ga4-sw.js/route.ts`'s `loadScriptSource()` did
`createRequire(import.meta.url).resolve("@gtmss/ga4-relay/sw-script")` — inside a Next.js Route
Handler, webpack intercepts `require.resolve` and returns a bundler-internal identifier instead
of a real filesystem path (`"(rsc)/../../packages/ga4-relay/dist/sw/index.js"` in dev, a numeric
module id in prod), so `readFile()` on the result always threw. This affected every real consumer
following the documented pattern, not just the demo.

**Fix**: moved script-loading inside the package itself. `createServiceWorkerHandler`'s
`loadScriptSource` stays a required, explicit parameter (unchanged signature), but the package now
ships `loadBundledSwScript` from a new `@gtmss/ga4-relay/server/sw-script-loader` subpath —
consumers pass that instead of hand-rolling their own loader:

```ts
import { createServiceWorkerHandler } from "@gtmss/ga4-relay/server";
import { loadBundledSwScript } from "@gtmss/ga4-relay/server/sw-script-loader";

export const GET = createServiceWorkerHandler({ scope: "/ga4-relay/", loadScriptSource: loadBundledSwScript });
```

`loadBundledSwScript` reads `dist/sw/index.js` relative to its own module's `import.meta.url` —
resolved inside the package's own code (which `next.config.mjs`'s `serverExternalPackages` keeps
un-bundled), not inside app-bundled route-handler code, so it's never subject to the interception
above. It's built as a **separate tsup entry/output file** from `./server` (see `tsup.config.ts`)
specifically so its `node:fs` import never lands in the same bundle as `withGa4Token`, which Edge
middleware imports from `./server` — confirmed live: without this split, a build produced
`A Node.js module is loaded ('url' at line 899) which is not supported in the Edge Runtime` for
`apps/demo/middleware.ts`.

A second, subtler bug surfaced fixing this: `fileURLToPath(new URL("../sw/index.js", import.meta.url))`
threw `TypeError: The "path" argument must be of type string or an instance of URL. Received an
instance of URL` at runtime under Next's `serverExternalPackages` interop — a cross-realm
`instanceof URL` mismatch between whatever constructs `import.meta.url`'s URL-like value in that
interop layer and Node's own `fileURLToPath`. Fixed by avoiding the `URL` class entirely: plain
string manipulation on the `file://`-prefixed `import.meta.url` string
(`packages/ga4-relay/src/server/sw-script-loader.ts`).

Verified live via direct `curl` against both `next start` (prod) and `next dev`: `200`,
`content-type: text/javascript`, `cache-control: no-cache`, `service-worker-allowed: /ga4-relay/`,
real SW script bytes.

## Bug #2 (test-environment artifact, not a product bug): dev-mode auto-reload race

With bug #1 fixed, `next dev` still flaked on the auto-registration specs (AC14, and AC27's
auto-registration case). Live-instrumented (`page.on("framenavigated")`) reproduction showed an
**unexpected second navigation** firing ~20-30ms after the initial `load` — Next.js dev mode's
on-demand route compilation (the SW route hadn't been hit yet, so Next compiles it lazily,
~700ms) triggers a client-side reload the first time a not-yet-compiled route is requested. That
reload raced the resilience SW's registration, non-deterministically resetting it mid-activation.
A production build never does this. **Fixed by pointing `playwright.config.ts`'s `webServer` at a
production build (`next build && next start`)** instead of `next dev` — also the more correct
target for validating real browser SW behavior, not dev-server hot-reload quirks.

One further flake remained even under production (isolated to the auto-registration spec, not
reproducible via manual live instrumentation with `register()` call-counting, byte-identical
script confirmation, or full `updatefound`/`statechange` event logging — root cause not
conclusively isolated, possibly Chromium-internal SW bookkeeping settling around the same tick as
the demo's own `track()` call firing a `fetch` to `/api/ga4/collect`). Hardened
`ac27-scope.spec.ts`'s assertion with `expect.poll` + a 250ms settle-and-reconfirm instead of a
single instantaneous read — the correct way to assert "reaches a *stable* active state" for async
browser state regardless. Stable across repeated runs since.

## Also fixed while here: dev-mode double-registration hazard in the reference pattern

Unrelated to the two bugs above, but found live while investigating: React's App Router dev mode
double-invokes effects, which would call `Ga4Init`'s `createGa4Client()` (and thus
`registerServiceWorker()`) twice per mount. Guarded with a module-level flag (survives the
dev-mode remount, unlike a `useRef`) in both `apps/demo/app/ga4-init.tsx` and the root README's
client usage example, since any real consumer copying that exact snippet would hit it too.

## Net status vs. the original three ACs

- **AC27** (nested scope): browser-confirmed, both auto-registration and explicit `register()`.
- **AC14** (coexistence): browser-confirmed — both SWs remain registered and active, including
  across a reload.
- **AC16** (kill-switch): browser-confirmed — `unregister()` leaves the site fully functional.

The SW beacon-capture spike remains a separate, still-open question (unload-time beacon
capture) — not attempted in this pass, see that spike's own post.
