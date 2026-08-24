import type { Store } from "./store.js";

export interface RelayConfig {
  measurementId: string;
  apiSecret: string;
  region?: "us" | "eu";
  tokenSecret: string;
  allowedOrigins: string[];
  store: Store;
  rateLimit?: { limit: number; windowMs: number };
  cookieDomain?: string;
  /** Package-level kill switch (default true). Requires a redeploy to flip — see create-collect-handler.ts. */
  enabled?: boolean;
  blockedParamNames?: string[];
  /** Test-only: overrides the MP endpoint base so integration tests hit a mock server. */
  endpointBaseOverride?: string;
}

export const DEFAULT_RATE_LIMIT = { limit: 120, windowMs: 60_000 };
