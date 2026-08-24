export interface ServiceWorkerConfig {
  /** Scope the SW should control — must match the client SDK's register({scope}) call (AC27). */
  scope: string;
  /**
   * The built SW script source (bundled from src/sw/index.ts by tsup).
   * Called lazily, at actual request time — not at module-eval time —
   * so a filesystem-backed loader (`() => readFileSync(...)`) is never
   * invoked during a bundler's build-time static module analysis, which
   * otherwise mishandles top-level fs reads in a route handler module.
   */
  loadScriptSource: () => string | Promise<string>;
}

/**
 * Factory for a Route Handler serving the SW script (plan step 2.3). An
 * npm package cannot write into a consumer's public/, so a served route —
 * not a static file — is the only distributable option. Response includes
 * Service-Worker-Allowed so an installer-chosen nested path (per the
 * ad-blocker path-configurability guidance) doesn't silently narrow the
 * SW's scope to that path's own directory (AC27).
 */
export function createServiceWorkerHandler(config: ServiceWorkerConfig) {
  return async function handler(): Promise<Response> {
    const scriptSource = await config.loadScriptSource();
    return new Response(scriptSource, {
      status: 200,
      headers: {
        "content-type": "text/javascript",
        "cache-control": "no-cache",
        "service-worker-allowed": config.scope,
      },
    });
  };
}
