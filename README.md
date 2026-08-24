# GA4 First-Party Server-Side Collection Relay

A self-hosted, first-party GA4 Measurement Protocol v2 relay for Next.js/Vercel — the
resilience-and-first-party-hosting layer stape.io sells, not a clone of Google Tag Manager
Server-Side. See [`.omc/plans/ga4-server-side-relay-plan.md`](.omc/plans/ga4-server-side-relay-plan.md)
for the full design (RALPLAN-DR consensus plan, three Architect + three Critic review rounds)
and [`.omc/progress.txt`](.omc/progress.txt) for the implementation log.

## What this is

- `packages/ga4-relay/` — the installable package. Import `./server` in Next.js Route Handlers
  and `middleware.ts`, `./client` in a client component that initializes tracking, and let
  `./sw` be served by `createServiceWorkerHandler`.
- `apps/demo/` — a reference Next.js install showing the exact wiring.

## Installing into your own Next.js app

### 1. Route handlers

```ts
// app/api/ga4/collect/route.ts
import { relay } from "@/lib/relay"; // your own createGa4Relay(config, deps) instance

export const runtime = "nodejs";
export const maxDuration = 10; // RECOMMENDED_MAX_DURATION from the package — not the 300s default

export const POST = relay.createCollectHandler();
```

```ts
// lib/relay.ts
import { after } from "next/server";
import { createGa4Relay, InMemoryStore, UpstashStore } from "@gtmss/ga4-relay/server";
import { Redis } from "@upstash/redis";

export const relay = createGa4Relay(
  {
    measurementId: process.env.GA4_MEASUREMENT_ID!,
    apiSecret: process.env.GA4_API_SECRET!,
    tokenSecret: process.env.GA4_TOKEN_SECRET!,
    allowedOrigins: process.env.GA4_ALLOWED_ORIGINS!.split(","),
    store: process.env.UPSTASH_REDIS_REST_URL
      ? new UpstashStore(Redis.fromEnv())
      : new InMemoryStore(), // dev-only — throws at construction in production, see below
    cookieDomain: process.env.GA4_COOKIE_DOMAIN,
  },
  { runAfterResponse: (cb) => after(cb) },
);
```

`createGa4Relay` **throws at construction** if `apiSecret`/`tokenSecret` are missing, or if
rate limiting is left on the in-memory `Store` while `NODE_ENV=production` — including during
`next build`, which always sets `NODE_ENV=production`. Set real `UPSTASH_REDIS_REST_URL`/
`UPSTASH_REDIS_REST_TOKEN` before building, not just before deploying. See `apps/demo/.env.example`.

### 2. Middleware — do NOT import your `relay` singleton here

```ts
// middleware.ts
import { NextResponse, type NextRequest } from "next/server";
import { withGa4Token, GA4_TOKEN_HEADER, serializeSetCookie } from "@gtmss/ga4-relay/server";

const resolveToken = withGa4Token({
  tokenSecret: process.env.GA4_TOKEN_SECRET!,
  cookieDomain: process.env.GA4_COOKIE_DOMAIN,
});

export async function middleware(request: NextRequest) {
  const { token, cookie } = await resolveToken(request);

  // Forward via a request header so the ROUTE HANDLER sees the token on
  // THIS request — a cookie set only via Set-Cookie is visible to the
  // browser's *next* request, not this one. Skipping this step means a
  // clean browser's very first request always 401s.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(GA4_TOKEN_HEADER, token);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.append("set-cookie", serializeSetCookie(cookie));
  return response;
}

export const config = { matcher: ["/api/ga4/:path*", "/ga4-relay/:path*"] };
```

Two things matter here: `withGa4Token` takes only `{ tokenSecret, cookieDomain }`, not your
full relay config — importing the full `createGa4Relay()` object into `middleware.ts` (which
Next.js always runs on the Edge runtime) would pull the Upstash client and other Node-only
code into the Edge bundle and break at runtime. And the header-forwarding step above is not
optional — see "Same-request token propagation" below.

### 3. Service worker (optional — resilience layer only, not required for basic collection)

```ts
// app/ga4-relay/ga4-sw.js/route.ts — served from a NESTED path deliberately
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServiceWorkerHandler } from "@gtmss/ga4-relay/server";

export const runtime = "nodejs";

export const GET = createServiceWorkerHandler({
  scope: "/ga4-relay/", // narrow — see "Service worker scope" below
  loadScriptSource: async () => {
    const require = createRequire(import.meta.url);
    return readFile(require.resolve("@gtmss/ga4-relay/sw-script"), "utf8");
  },
});
```

### 4. Client

```tsx
"use client";
import { useEffect } from "react";
import { createGa4Client } from "@gtmss/ga4-relay/client";

// Module-level, not component-instance-scoped: App Router's dev-mode
// double-invokes effects (mount → cleanup → mount), which would otherwise
// call createGa4Client() — and register the SW — twice in quick succession.
// A useRef guard wouldn't survive the dev-mode remount; this does. Only
// matters in dev — production builds don't double-invoke effects.
let ga4ClientInitialized = false;

export function Ga4Init() {
  useEffect(() => {
    if (ga4ClientInitialized) return;
    ga4ClientInitialized = true;
    const client = createGa4Client({
      collectUrl: "/api/ga4/collect",
      swScriptUrl: "/ga4-relay/ga4-sw.js", // omit to skip the SW entirely
      swScope: "/ga4-relay/",
    });
    client.track({ event_id: crypto.randomUUID(), name: "page_view", params: {} });
  }, []);
  return null;
}
```

### 5. CMP / Consent Mode v2 integration contract

This package only **consumes** consent signals — it does not integrate with any specific CMP.
Your CMP integration must:

- Set `window.__ga4RelayConsent` to the current `{ ad_storage, ad_user_data, ad_personalization,
  analytics_storage }` signal (all `"granted"` or `"denied"`) as early as possible.
- Dispatch `window.dispatchEvent(new CustomEvent("ga4-relay:consent", { detail: signal }))`
  whenever consent changes.

An absent signal, or `analytics_storage !== "granted"`, is treated as fully denied — no cookie,
no identity in the response body, no outbound GA4 call. An explicit denial with an existing
relay cookie triggers cookie deletion (the relay's cookies are `HttpOnly`; your CMP's JavaScript
cannot delete them itself). An explicit denial also purges the offline queue.

## Design notes worth knowing before you deploy

**Same-request token propagation.** `withGa4Token`'s cookie is only visible to the browser's
*next* request. The collect handler reads the token from the `x-ga4-relay-token` header
(`GA4_TOKEN_HEADER`) that your `middleware.ts` forwards on the *current* request, falling back
to the cookie for anything that only ever sets it there. If you write your own middleware
without the header-forwarding step above, every clean browser's first request will 401.

**Service worker scope.** The reference wiring serves the SW from `/ga4-relay/ga4-sw.js`
(a nested path), giving it a natural default scope of `/ga4-relay/` — narrow enough that it
can never take over a host site's existing service worker at a broader scope. Widening this
via `Service-Worker-Allowed` to `/` is possible but is a deliberate opt-in you should only make
after confirming there's no conflicting host SW; two service workers cannot both control the
same scope; the second registration replaces the first there.

**Dedupe fail-open vs. fail-closed.** A dedupe-store outage fails **open** (forwards the event)
for a fresh, never-before-sent live event — silently dropping brand-new traffic while returning
`200` would be undetectable data loss. It fails **closed** (drops the event) for a *replayed*
queued event, where the event has already been attempted once and losing it again is the safer
side, matching Principle 5 (retry and dedupe ship together, never separately).

**Delivery is best-effort in v1.** `after()`/`waitUntil()` work is cancelled if the function
times out and isn't durable across an instance dying mid-request. At-least-once delivery would
require a durable queue (QStash/Vercel Queues) — explicitly out of scope for v1.

**Rate limiting requires Upstash in production.** The in-memory `Store` is dev-only; `createGa4Relay`
throws at construction if it's used with rate limiting enabled while `NODE_ENV=production`.

## Known environment-blocked verification gaps

Some acceptance criteria require resources not available in the environment this was built and
tested in (no real GA4 property, no outbound network access for Playwright browser binaries).
Each is documented with what was verified instead and how to close the gap:

- [`docs/spikes/mp-fidelity.md`](docs/spikes/mp-fidelity.md) — real-GA4 fidelity comparison (M0.1)
- [`docs/spikes/sw-beacon-capture.md`](docs/spikes/sw-beacon-capture.md) — cross-browser unload-beacon capture (M0.2)
- [`docs/spikes/first-party-mode.md`](docs/spikes/first-party-mode.md) — Google's native first-party mode on Vercel (M0.3)
- [`docs/spikes/safari-itp-observation.md`](docs/spikes/safari-itp-observation.md) — 8-day Safari cookie-longevity observation (M0.4)
- [`docs/spikes/playwright-browser-e2e.md`](docs/spikes/playwright-browser-e2e.md) — SW coexistence/registration browser e2e (US-016)

## Development

```sh
pnpm install
pnpm --filter ga4-relay build   # tsup: dist/server, dist/client, dist/sw
pnpm exec vitest run            # unit + integration tests (mock MP server, fake-indexeddb)
pnpm run typecheck
pnpm exec eslint .              # includes the client/server entrypoint-boundary rule
pnpm --filter demo build        # apps/demo — requires apps/demo/.env.local, see .env.example
```

## Releasing

Versioning and the changelog are managed with [Changesets](https://github.com/changesets/changesets).

```sh
pnpm changeset      # add a changeset describing a user-facing change (per PR)
pnpm run version    # consume pending changesets into a version bump + CHANGELOG update
pnpm run build      # build packages/ga4-relay before publishing
pnpm run release    # publish packages/ga4-relay to npm
```

`apps/demo` is private and ignored by Changesets — it never gets a changeset prompt or version bump.
