"use client";

import { useEffect } from "react";
import { createGa4Client } from "@gtmss/ga4-relay/client";

export function Ga4Init() {
  useEffect(() => {
    const client = createGa4Client({
      collectUrl: "/api/ga4/collect",
      swScriptUrl: "/ga4-relay/ga4-sw.js",
      swScope: "/ga4-relay/",
    });
    client.track({ event_id: crypto.randomUUID(), name: "page_view", params: {} });
  }, []);
  return null;
}
