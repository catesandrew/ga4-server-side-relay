import { readFile } from "node:fs/promises";
import path from "node:path";

let cachedBundledScript: Promise<string> | undefined;

/**
 * Reads this package's own dist/sw/index.js off disk, relative to this
 * file's own `import.meta.url`. Built as a separate tsup entry from
 * `./server` (see tsup.config.ts) specifically so its `node:fs` import
 * never lands in the same output file as `withGa4Token`, which Edge
 * middleware imports from `./server` — Edge doesn't support Node built-ins.
 *
 * Deliberately avoids `new URL(...)`/`fileURLToPath` — Next.js's
 * `serverExternalPackages` runtime interop constructs `import.meta.url`
 * URL-like values from a different realm than the one Node's own
 * `fileURLToPath` checks against, so `fileURLToPath(new URL(...))` throws
 * `ERR_INVALID_ARG_TYPE: Received an instance of URL` at runtime inside a
 * Next.js Route Handler even though the exact same call works in plain
 * Node. Plain string path manipulation on the `file://`-prefixed
 * `import.meta.url` string sidesteps the cross-realm `instanceof URL` check
 * entirely.
 *
 * Pass this as `ServiceWorkerConfig.loadScriptSource` in your SW route
 * handler instead of hand-rolling a `createRequire(...).resolve(...)`
 * loader, which is intercepted (and broken) by Next.js's own webpack
 * bundling of Route Handler modules.
 */
export async function loadBundledSwScript(): Promise<string> {
  if (!cachedBundledScript) {
    const currentFilePath = import.meta.url.startsWith("file://")
      ? import.meta.url.slice("file://".length)
      : import.meta.url;
    const swScriptPath = path.join(path.dirname(currentFilePath), "..", "sw", "index.js");
    cachedBundledScript = readFile(swScriptPath, "utf8");
  }
  return cachedBundledScript;
}
