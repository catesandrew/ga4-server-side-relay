import { after } from "next/server";
import { createGa4Relay, InMemoryStore, UpstashStore } from "@gtm-server-side/ga4-relay/server";
import { Redis } from "@upstash/redis";

function buildStore() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return new UpstashStore(Redis.fromEnv());
  }
  return new InMemoryStore();
}

export const relay = createGa4Relay(
  {
    measurementId: process.env.GA4_MEASUREMENT_ID ?? "",
    apiSecret: process.env.GA4_API_SECRET ?? "",
    region: (process.env.GA4_REGION as "us" | "eu") ?? "us",
    tokenSecret: process.env.GA4_TOKEN_SECRET ?? "",
    allowedOrigins: (process.env.GA4_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean),
    store: buildStore(),
    cookieDomain: process.env.GA4_COOKIE_DOMAIN,
    enabled: process.env.GA4_RELAY_ENABLED !== "false",
  },
  { runAfterResponse: (cb) => after(cb) },
);
