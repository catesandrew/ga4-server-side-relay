import { createServiceWorkerHandler } from "@gtmss/ga4-relay/server";
import { loadBundledSwScript } from "@gtmss/ga4-relay/server/sw-script-loader";

export const runtime = "nodejs";

// loadBundledSwScript reads this package's own built dist/sw/index.js from
// inside the package's own module, not from inside this app-bundled route
// handler — a hand-rolled createRequire(import.meta.url).resolve(...) loader
// here would silently break under both next dev and next build/start, since
// Next's webpack intercepts require.resolve inside Route Handler modules and
// doesn't return a real filesystem path (see create-service-worker-handler.ts's
// ServiceWorkerConfig doc). It's imported from a separate subpath
// (@gtmss/ga4-relay/server/sw-script-loader), not the main ./server export,
// so its node:fs usage never lands in the same bundle Edge middleware pulls
// withGa4Token from.
//
// Served from a NESTED path (/ga4-relay/ga4-sw.js), not the site root, so
// its natural default scope is /ga4-relay/ — narrow enough to never take
// over a host site's existing root-scoped service worker (AC14). Widening
// this to "/" via Service-Worker-Allowed is possible but is a deliberate
// opt-in for installers who have verified there's no conflicting host SW.
export const GET = createServiceWorkerHandler({ scope: "/ga4-relay/", loadScriptSource: loadBundledSwScript });
