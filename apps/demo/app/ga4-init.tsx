"use client";

import { useEffect, useState } from "react";
import { createGa4Client } from "@gtmss/ga4-relay/client";
import { DEMO_TEST_IDS } from "../lib/test-ids/catalog";

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

type TrackStatus = "idle" | "tracked";

export function Ga4Init() {
  // Drives both the sentinel's data-state/aria-busy below AND whether
  // client.track() has fired — a Playwright spec observes this same
  // variable to confirm exactly one page_view was sent even under React's
  // dev-mode double-invoke (see the module-level guard comment above).
  const [trackStatus, setTrackStatus] = useState<TrackStatus>("idle");
  const [trackEpoch, setTrackEpoch] = useState(0);

  useEffect(() => {
    if (ga4ClientInitialized) return;
    ga4ClientInitialized = true;
    try {
      const client = createGa4Client({
        collectUrl: "/api/ga4/collect",
        swScriptUrl: "/ga4-relay/ga4-sw.js",
        swScope: "/ga4-relay/",
      });
      client.track({ event_id: crypto.randomUUID(), name: "page_view", params: {} });
      setTrackStatus("tracked");
      setTrackEpoch((epoch) => epoch + 1);
    } catch (error) {
      // Reset the guard on failure so it isn't stuck permanently latched
      // with the sentinel frozen at "idle" and no page_view ever sent.
      ga4ClientInitialized = false;
      console.error("Ga4Init: failed to initialize GA4 client", error);
    }
  }, []);

  // Hidden, always-mounted sentinel: Ga4Init otherwise renders nothing, so
  // this is the only DOM surface Playwright has to observe the page_view
  // auto-track and double-invoke-guard behavior described above.
  return (
    <div
      data-testid={DEMO_TEST_IDS.ga4Init.statusSentinel}
      data-state={trackStatus}
      data-track-epoch={trackEpoch}
      aria-busy={trackStatus === "idle"}
      aria-hidden="true"
      style={{ display: "none" }}
    />
  );
}
