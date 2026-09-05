---
sidebar_position: 3
---

# Design Notes

A few behavioral details worth understanding before you deploy `@gtmss/ga4-relay` to
production.

## Same-request token propagation

`withGa4Token`'s cookie is only visible to the browser's *next* request. The collect handler
reads the token from the `x-ga4-relay-token` header (`GA4_TOKEN_HEADER`) that your
`middleware.ts` forwards on the *current* request, falling back to the cookie for anything
that only ever sets it there. If you write your own middleware without the header-forwarding
step described in [Installation](./installation#2-middleware--do-not-import-your-relay-singleton-here),
every clean browser's first request will 401.

## Service worker scope

The reference wiring serves the SW from `/ga4-relay/ga4-sw.js` (a nested path), giving it a
natural default scope of `/ga4-relay/` — narrow enough that it can never take over a host
site's existing service worker at a broader scope. Widening this via `Service-Worker-Allowed`
to `/` is possible but is a deliberate opt-in you should only make after confirming there's no
conflicting host SW; two service workers cannot both control the same scope; the second
registration replaces the first there.

## Dedupe fail-open vs. fail-closed

A dedupe-store outage fails **open** (forwards the event) for a fresh, never-before-sent live
event — silently dropping brand-new traffic while returning `200` would be undetectable data
loss. It fails **closed** (drops the event) for a *replayed* queued event, where the event has
already been attempted once and losing it again is the safer side, matching Principle 5
(retry and dedupe ship together, never separately).

## Delivery is best-effort in v1

`after()`/`waitUntil()` work is cancelled if the function times out and isn't durable across an
instance dying mid-request. At-least-once delivery would require a durable queue
(QStash/Vercel Queues) — explicitly out of scope for v1.

## Rate limiting requires Upstash in production

The in-memory `Store` is dev-only; `createGa4Relay` throws at construction if it's used with
rate limiting enabled while `NODE_ENV=production`.
