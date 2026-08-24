export interface ServiceWorkerConfig {
  /** Scope the SW should control — must match the client SDK's register({scope}) call (AC27). */
  scope: string;
  /**
   * The built SW script source (bundled from src/sw/index.ts by tsup).
   * Called lazily, at actual request time — not at module-eval time —
   * so a filesystem-backed loader (`() => readFileSync(...)`) is never
   * invoked during a bundler's build-time static module analysis, which
   * otherwise mishandles top-level fs reads in a route handler module.
   *
   * Do NOT hand-roll a `createRequire(import.meta.url).resolve(...)` loader
   * in your own route handler — inside a Next.js Route Handler that call is
   * intercepted by webpack's static module resolution (both `next dev` and
   * `next build`/`next start`) and does not return a real filesystem path,
   * so `readFile()` on the result throws. Use `loadBundledSwScript` from
   * `@gtmss/ga4-relay/server/sw-script-loader` instead — it reads this
   * package's own built dist/sw/index.js from inside this package's own
   * module (which consuming apps mark external via `serverExternalPackages`),
   * not from inside app-bundled route-handler code, so it isn't intercepted.
   *
   * That loader lives in a separate subpath/bundle from `./server` on
   * purpose: its `node:fs`/`node:url` usage must never end up in the same
   * output file as `withGa4Token`, which Edge middleware imports from
   * `./server` — Edge doesn't support Node built-ins, and tsup bundles a
   * whole entry file's reachable code into one output, so keeping this
   * factory itself fs-free is what keeps `./server` Edge-safe.
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
