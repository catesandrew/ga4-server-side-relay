import type { RelayConfig } from "./config.js";
import { InMemoryStore } from "./store.js";
import { createCollectHandler, type CollectHandlerDeps } from "./create-collect-handler.js";
import { createDebugHandler } from "./create-debug-handler.js";
import { createServiceWorkerHandler, type ServiceWorkerConfig } from "./create-service-worker-handler.js";
import { withGa4Token } from "./with-token-middleware.js";

/**
 * AC23: validates at construction and throws rather than degrading
 * silently — boot-time failure beats a defanged-but-passing control.
 */
function assertValidConfig(config: RelayConfig): void {
  if (!config.apiSecret) {
    throw new Error("createGa4Relay: config.apiSecret is required");
  }
  if (!config.tokenSecret) {
    throw new Error("createGa4Relay: config.tokenSecret is required");
  }
  const rateLimitingEnabled = config.enabled !== false;
  const usingInMemoryStoreInProd =
    rateLimitingEnabled && config.store instanceof InMemoryStore && process.env.NODE_ENV === "production";
  if (usingInMemoryStoreInProd) {
    throw new Error(
      "createGa4Relay: rate limiting is enabled with the in-memory Store while NODE_ENV=production. " +
        "The in-memory Store is dev-only and does not function across Vercel's multi-instance deployment model. " +
        "Configure the Upstash Store implementation for production.",
    );
  }
}

export function createGa4Relay(config: RelayConfig, deps: CollectHandlerDeps = {}) {
  assertValidConfig(config);
  return {
    createCollectHandler: () => createCollectHandler(config, deps),
    createDebugHandler: () => createDebugHandler(config),
    createServiceWorkerHandler: (swConfig: ServiceWorkerConfig) => createServiceWorkerHandler(swConfig),
    /**
     * Convenience only — bound to the SAME config object used to build
     * this relay. Do NOT import the object returned by createGa4Relay()
     * into middleware.ts: Next.js middleware runs on the Edge runtime
     * only, and importing this whole object pulls the full server module
     * graph (store/mp-client/etc.) into the Edge bundle. In middleware.ts,
     * import `withGa4Token` directly from the package instead, with a
     * config literal containing only tokenSecret/cookieDomain — see the
     * package README and apps/demo/middleware.ts for the correct pattern.
     */
    withGa4Token: withGa4Token(config),
  };
}
