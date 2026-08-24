import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServiceWorkerHandler } from "@gtmss/ga4-relay/server";

export const runtime = "nodejs";

// Lazy: resolved only when the route actually handles a request, not at
// module-eval/build-analysis time (see create-service-worker-handler.ts).
async function loadScriptSource(): Promise<string> {
  const require = createRequire(import.meta.url);
  const swScriptPath = require.resolve("@gtmss/ga4-relay/sw-script");
  return readFile(swScriptPath, "utf8");
}

// Served from a NESTED path (/ga4-relay/ga4-sw.js), not the site root, so
// its natural default scope is /ga4-relay/ — narrow enough to never take
// over a host site's existing root-scoped service worker (AC14). Widening
// this to "/" via Service-Worker-Allowed is possible but is a deliberate
// opt-in for installers who have verified there's no conflicting host SW.
export const GET = createServiceWorkerHandler({ scope: "/ga4-relay/", loadScriptSource });
