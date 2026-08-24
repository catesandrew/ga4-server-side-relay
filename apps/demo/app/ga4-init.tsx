"use client";

import { useEffect } from "react";
import { createGa4Client } from "@gtmss/ga4-relay/client";

// Module-level, not component-instance-scoped: React's App Router dev mode
// intentionally double-invokes effects (mount → cleanup → mount) to surface
// missing cleanup, which would otherwise call createGa4Client() (and thus
// register the SW) twice in quick succession — a real race caught live via
// Playwright e2e (packages/ga4-relay/e2e/ac27-scope.spec.ts,
// ac14-coexistence.spec.ts): the first registration transiently reports
// active before a second, redundant one supersedes it. A useRef guard
// wouldn't survive the dev-mode remount; this module-level flag does,
// since it isn't reset when the component instance is torn down and
// recreated. Production builds don't double-invoke effects, so this only
// matters for local dev, but real consumers copying this pattern will hit
// it in their own dev environments too.
let ga4ClientInitialized = false;

export function Ga4Init() {
  useEffect(() => {
    if (ga4ClientInitialized) return;
    ga4ClientInitialized = true;
    const client = createGa4Client({
      collectUrl: "/api/ga4/collect",
      swScriptUrl: "/ga4-relay/ga4-sw.js",
      swScope: "/ga4-relay/",
    });
    client.track({ event_id: crypto.randomUUID(), name: "page_view", params: {} });
  }, []);
  return null;
}
