---
sidebar_position: 2
---

# Installation

This page walks through wiring `@gtmss/ga4-relay` into your own Next.js app: a route
handler, middleware, an optional service worker, a client-side init, and the CMP / Consent
Mode v2 integration contract your consent-management platform must implement.

## 1. Route handlers

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

## 2. Middleware — do NOT import your `relay` singleton here

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
optional — see [Same-request token propagation](./design-notes#same-request-token-propagation)
below.

## 3. Service worker (optional — resilience layer only, not required for basic collection)

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

## 4. Client

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

## 5. CMP / Consent Mode v2 integration contract

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

## Next steps

See [Design Notes](./design-notes) for the behavioral details worth understanding before you
deploy this to production.
