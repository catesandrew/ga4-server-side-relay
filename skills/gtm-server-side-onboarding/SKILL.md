---
name: gtm-server-side-onboarding
description: Use when wiring a Next.js/Vercel app to consume @gtmss/ga4-relay — a self-hosted, first-party GA4 Measurement Protocol v2 relay (the resilience-and-first-party-hosting layer stape.io sells, not a GTM Server-Side clone). Covers the four wiring points (route handler, middleware, optional service worker, client init) plus the CMP/Consent Mode v2 contract the package only consumes, never implements. Load-bearing gotchas this hides: middleware.ts must import only withGa4Token({ tokenSecret, cookieDomain }) — never the full createGa4Relay() config — because Next.js always runs middleware on Edge and the full config pulls in the Upstash client and other Node-only code that breaks there; the middleware must forward the resolved token via the x-ga4-relay-token request header (not just rely on the Set-Cookie), since a cookie set by middleware is only visible to the browser's NEXT request, so skipping the header means every clean browser's first request 401s; the client init guard must be module-level state, not a useRef, because App Router dev-mode double-invokes effects (mount→cleanup→mount) and only module-level state survives that remount to prevent double SW registration; createGa4Relay throws at construction if apiSecret/tokenSecret are missing or if rate limiting is left on the in-memory Store while NODE_ENV=production — which `next build` always sets, so real UPSTASH_REDIS_REST_URL/TOKEN must be set before building, not just before deploying; and the service worker should be served from a nested path like /ga4-relay/ga4-sw.js so its default scope stays narrow and can never take over a host site's existing service worker. Also covers the CMP integration contract (window.__ga4RelayConsent + the ga4-relay:consent CustomEvent) and export-path boundaries (./server for Node-only code, ./client for the browser, ./sw-script for the service worker body — crossing them pulls Node-only code into an Edge/browser bundle). Triggers on "onboard a repo to gtm-server-side", "wire up @gtmss/ga4-relay", "add the GA4 relay to a Next.js app", "install ga4-relay", "GA4 relay 401 on first request", "ga4-relay middleware edge runtime error", "ga4-relay consent contract", "ga4-relay service worker scope", or integrating this repo's ga4-relay package into another Next.js/Vercel project.
---

# gtm-server-side-onboarding

## Overview

`@gtmss/ga4-relay` (published from `packages/ga4-relay/` in this repo) is a
self-hosted, first-party GA4 Measurement Protocol v2 relay for Next.js/Vercel.
Onboarding a consuming repo means wiring four integration points — a collect
route handler, `middleware.ts`, an optional service worker route, and a
client-side init — plus satisfying a consent-signal contract the package only
consumes, never implements. Every gotcha below was already load-bearing enough
to earn an inline comment in this repo's own reference install
(`apps/demo/`) and root `README.md`; this skill exists so a *different* repo
gets the same wiring right the first time instead of rediscovering each one
via a 401 or a broken Edge bundle.

## The invariants

1. **`middleware.ts` imports `withGa4Token({ tokenSecret, cookieDomain })`,
   never the full `createGa4Relay()` singleton.** Next.js always runs
   `middleware.ts` on the Edge runtime. The full relay config pulls in the
   Upstash client and other Node-only code — importing it into middleware
   breaks at runtime on Edge, not at build time, so this surfaces late.
   Copy `references/middleware.ts.template` as-is rather than importing your
   `lib/relay.ts` singleton from it.
   *Verify:* `middleware.ts` has no import from your own relay-instance
   module (e.g. `lib/relay.ts`) — only `@gtmss/ga4-relay/server`'s
   `withGa4Token`, `GA4_TOKEN_HEADER`, `serializeSetCookie`.

2. **Middleware must forward the resolved token via the `x-ga4-relay-token`
   request header, not just via `Set-Cookie`.** A cookie set by middleware is
   only visible to the browser's *next* request — the collect route handler
   needs to see the token on *this* request. `withGa4Token`'s cookie alone
   means a clean browser's very first collect call 401s. See
   `references/middleware.ts.template` for the exact
   `requestHeaders.set(GA4_TOKEN_HEADER, token)` step.
   *Verify:* a fresh browser (no existing relay cookie) hitting the app for
   the first time gets a 200 from `/api/ga4/collect`, not a 401.

3. **The collect route handler sets `maxDuration = 10` (or the package's
   `RECOMMENDED_MAX_DURATION`), not the framework's 300s default.**
   `runAfterResponse` work (dedupe write, upstream GA4 POST) needs to
   complete before the function is torn down; leaving the default duration
   doesn't fail loudly, it just makes background delivery unreliable under
   load. Copy `references/route-handler.ts.template`.
   *Verify:* the route handler module exports `maxDuration = 10` (or the
   package constant) alongside `runtime = "nodejs"`.

4. **`createGa4Relay` throws at construction if `apiSecret`/`tokenSecret` are
   missing, or if rate limiting stays on the in-memory `Store` while
   `NODE_ENV=production` — and `next build` always sets that.** Real
   `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` must be set **before
   building**, not just before deploying, or the build itself fails. Copy
   `references/env.example.template` to `.env.local` for dev and wire the
   same keys into your deploy target's env vars before the first production
   build.
   *Verify:* running the app's production build (`next build`) with
   `NODE_ENV=production` and real Upstash env vars set does not throw from
   `createGa4Relay`.

5. **The client init guard is module-level state, not a `useRef`.** App
   Router's dev-mode double-invokes effects (mount → cleanup → mount), which
   would otherwise call `createGa4Client()` — and register the service
   worker — twice in quick succession. A `useRef` guard resets on the
   remount and wouldn't catch this; module-level state survives it. Only
   matters in dev — production builds don't double-invoke effects. Copy
   `references/client-init.tsx.template`.
   *Verify:* in dev mode, the service worker registers exactly once (check
   the browser's Application/Service Workers panel after a hard reload) —
   not twice.

6. **The optional service worker is served from a nested path (e.g.
   `/ga4-relay/ga4-sw.js`), giving it a narrow default scope.** This is
   deliberate: it means the relay's SW can never take over a host site's
   existing service worker at a broader scope. Widening scope via
   `Service-Worker-Allowed: /` is possible but is an opt-in you make only
   after confirming there's no conflicting host SW — two service workers
   cannot both control the same scope; the second registration replaces the
   first there. Copy `references/sw-route.ts.template`; skip this step
   entirely if you don't need the offline-queue resilience layer.
   *Verify:* the SW's registered scope (DevTools → Application → Service
   Workers) is `/ga4-relay/`, not `/`, unless you deliberately widened it.

7. **The CMP integration contract is consumed, not implemented, by this
   package.** Your own CMP integration must set
   `window.__ga4RelayConsent` to the current `{ ad_storage, ad_user_data,
   ad_personalization, analytics_storage }` signal (all `"granted"` or
   `"denied"`) as early as possible, and dispatch
   `window.dispatchEvent(new CustomEvent("ga4-relay:consent", { detail:
   signal }))` whenever consent changes. An absent signal, or
   `analytics_storage !== "granted"`, is treated as fully denied — no
   cookie, no identity in the response body, no outbound GA4 call. An
   explicit denial with an existing relay cookie triggers cookie deletion
   (the relay's cookies are `HttpOnly`; your CMP's JavaScript cannot delete
   them itself) and purges the offline queue.
   *Verify:* toggling consent to denied in your CMP results in the relay
   cookie being cleared (check DevTools → Application → Cookies) and no
   further `/api/ga4/collect` calls carrying identity.

8. **Never cross the package's `./server` / `./client` / `./sw-script`
   export boundaries.** `./server` is Node-only (imports the Upstash client);
   `./client` is browser-only; `./sw-script` is the service worker body
   loaded via `readFile`/`require.resolve`, not imported directly. Importing
   `./server` from a client component, or `./client` from middleware/a route
   handler, breaks the bundle for the runtime that doesn't support it.
   *Verify:* `pnpm exec eslint .` in the consuming repo passes — if this
   repo's own client/server entrypoint-boundary lint rule is copied over, it
   catches this; otherwise, grep each entrypoint's imports by hand.

## Red flags

- Importing `lib/relay.ts` (the full `createGa4Relay()` instance) into
  `middleware.ts` → invariant 1; works locally, breaks on Edge in
  deployment.
- Middleware that sets only a cookie and never forwards
  `x-ga4-relay-token` as a request header → invariant 2; every clean
  browser's first request 401s, easy to miss if your own testing always has
  a warm cookie.
- Leaving the collect route handler's `maxDuration` at the framework
  default → invariant 3; background delivery becomes unreliable under load,
  not an immediate failure.
- Deploying with `UPSTASH_REDIS_REST_URL` unset and discovering the build
  itself fails, not just the deploy → invariant 4; set it before the first
  production build, not after.
- A `useRef`-based init guard in the client component → invariant 5; passes
  in production, silently double-registers the SW in dev.
- Serving the service worker from `/` instead of a nested path without
  first confirming no host SW exists → invariant 6; the relay SW silently
  replaces the host's SW at that scope.
- Building your own consent gating logic instead of setting
  `window.__ga4RelayConsent` / dispatching `ga4-relay:consent` → invariant
  7; the package already implements the deny/purge/delete behavior, it just
  needs the signal.
- Importing `@gtmss/ga4-relay/server` from a `"use client"` component (or
  vice versa) → invariant 8; breaks the bundle for whichever runtime doesn't
  support the crossed-in code.

## References

- `references/route-handler.ts.template` — the collect route handler
  (`app/api/ga4/collect/route.ts`).
- `references/relay-instance.ts.template` — the `lib/relay.ts` singleton
  (`createGa4Relay` config + `runAfterResponse`).
- `references/middleware.ts.template` — `middleware.ts`, the Edge-safe
  `withGa4Token` wiring with header-forwarding.
- `references/sw-route.ts.template` — the optional service worker route
  (`app/ga4-relay/ga4-sw.js/route.ts`).
- `references/client-init.tsx.template` — the client component that calls
  `createGa4Client` with the module-level double-invoke guard.
- `references/env.example.template` — the env vars this package needs
  (`GA4_MEASUREMENT_ID`, `GA4_API_SECRET`, `GA4_TOKEN_SECRET`,
  `GA4_ALLOWED_ORIGINS`, `GA4_COOKIE_DOMAIN`, `UPSTASH_REDIS_REST_URL`,
  `UPSTASH_REDIS_REST_TOKEN`).
- Source: this repo's own `README.md` ("Installing into your own Next.js
  app") and `apps/demo/` (the reference install these templates are copied
  from).
