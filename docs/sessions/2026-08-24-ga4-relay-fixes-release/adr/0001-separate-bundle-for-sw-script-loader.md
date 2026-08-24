# ADR 0001: Ship the SW script loader as a separate bundle/export subpath, not a default inside `./server`

- **Status:** accepted
- **Date:** 2026-08-24
- **Deciders:** Andrew Cates (session-directed), implemented by agent

## Context

`createServiceWorkerHandler`'s consumer-facing pattern (`createRequire(import.meta.url).resolve(...)`
+ `readFile()`, written by hand in every consumer's own Route Handler) was found via live
Playwright e2e to 500 in both `next dev` and production — Next.js's webpack bundling intercepts
`require.resolve` inside Route Handler modules and returns a bundler-internal identifier instead
of a real filesystem path.

The fix needs the package itself to read its own built `dist/sw/index.js` at runtime, using
`node:fs` and its own `import.meta.url`. But `@gtmss/ga4-relay`'s `./server` export is also where
Edge middleware imports `withGa4Token` from (`with-token-middleware.ts`), and this package has
already been burned once before by Node-only code leaking into an Edge bundle (the original
"full-relay-singleton pollution of Edge bundle" issue from the initial build). tsup bundles a
whole entry file's reachable code into one physical output file — so where the new fs-touching
code physically lives matters as much as its own correctness.

## Options considered

1. **Default `loadScriptSource` inside `create-service-worker-handler.ts` itself** — smallest
   diff, `loadScriptSource` becomes optional. Pros: minimal API surface change. Cons: this file is
   part of the same tsup entry (`src/server/index.ts` → `dist/server/index.js`) that middleware
   imports `withGa4Token` from — tried first, confirmed live via `next build` to produce
   `A Node.js module is loaded ('url') which is not supported in the Edge Runtime` for
   `apps/demo/middleware.ts`, relying on tree-shaking that didn't hold.
2. **Separate tsup entry / export subpath** (`@gtmss/ga4-relay/server/sw-script-loader`) —
   `loadScriptSource` stays required on `ServiceWorkerConfig` (no API change to the factory
   itself); consumers explicitly import `loadBundledSwScript` from the new subpath and pass it.
   Pros: physically separate output file, so its `node:fs` import can never end up in the same
   bundle as `withGa4Token` regardless of any bundler's tree-shaking behavior — verified via a
   real `next build` producing a clean middleware bundle (35.1 kB, matching the pre-bug baseline).
   Cons: one extra import line in consumer route handlers instead of a silent default.
3. **Ship the SW script as a string constant / bundled asset** (e.g. embed the built SW source as
   a JS string export instead of a file to `readFile()`) — would avoid `node:fs` entirely. Not
   pursued: larger change to the build pipeline, and the actual bug was in *path resolution*, not
   in needing `fs` per se; the existing `require.resolve`-based approach already assumed a real fs
   read was fine (correctly, per production and dev curl tests) once the path was resolved
   correctly.

## Decision

Option 2: separate tsup entry outputting `dist/server/sw-script-loader.js`, exported at
`@gtmss/ga4-relay/server/sw-script-loader`, containing `loadBundledSwScript()`. `createServiceWorkerHandler`
itself stays completely fs-free; `ServiceWorkerConfig.loadScriptSource` remains a required
parameter (not defaulted) specifically so it's obvious at the call site which subpath a consumer
is pulling in. **Because** physical build-output separation is the only verification-backed
guarantee against Edge-bundle pollution available here — tree-shaking-based safety was tried and
empirically failed.

## Consequences

- **Positive:** `./server`'s Edge-safety is now enforced by build topology, not by hoping a
  consumer's bundler correctly eliminates dead code. `middleware.ts` stays provably Node-module-free.
- **Negative / cost:** consumers must add one explicit import
  (`import { loadBundledSwScript } from "@gtmss/ga4-relay/server/sw-script-loader"`) instead of
  getting a bare-minimum default for free. Documented in the README's SW section and
  `docs/spikes/playwright-browser-e2e.md`.
- **Follow-on:** none outstanding from this decision specifically — verified end-to-end via real
  browser e2e (`packages/ga4-relay/e2e/`) and a real `next build`.

## Notes

- Code: `packages/ga4-relay/src/server/sw-script-loader.ts`,
  `packages/ga4-relay/tsup.config.ts` (new `"sw-script-loader"` entry key),
  `packages/ga4-relay/package.json` (new `./server/sw-script-loader` export),
  `apps/demo/app/ga4-relay/ga4-sw.js/route.ts` (consumer usage).
- Related: `docs/spikes/playwright-browser-e2e.md` "Bug #1" section has the full live-reproduction
  detail (exact error messages, both dev and prod).
- Commit: `26c805e`.
