import { createGa4Client } from "@gtmss/ga4-relay/client";

const GA4_CLIENT_OPTIONS = {
  collectUrl: "/api/ga4/collect",
  swScriptUrl: "/ga4-relay/ga4-sw.js",
  swScope: "/ga4-relay/",
};

/** Structural subset of createGa4Client's return value — narrowed so this module's public type doesn't need to name the library's internal Ga4Event type. */
export interface Ga4Client {
  track(event: { event_id: string; name: string; params: Record<string, string | number | boolean> }): void;
}

// Module-level singleton: every consumer (Ga4Init's auto page_view,
// ConsentControls' manual track-after-consent-change calls) must resolve to
// the SAME client instance rather than each minting its own, which would
// double-register the resilience SW. Also survives React's App Router dev
// mode double-invoking a mount effect (mount -> cleanup -> mount), since
// module state isn't reset when a component instance is torn down and
// recreated.
let client: Ga4Client | undefined;

export function getGa4Client(): Ga4Client {
  if (!client) {
    client = createGa4Client(GA4_CLIENT_OPTIONS);
  }
  return client;
}
