# Lessons — GA4 relay live-verification fixes + 0.1.1 release (2026-08-24)

## Unit-test stubs hid a broken "documented pattern" for months

- **What happened:** every unit test for `createServiceWorkerHandler` passed a stubbed
  `loadScriptSource: () => "// sw script"`. The real `createRequire(import.meta.url).resolve(...)`
  + `readFile()` codepath — the *exact pattern the README told every consumer to write* — had
  never actually executed until real Playwright e2e ran it, and it 500'd in both dev and prod.
- **Why:** `require.resolve()` inside a Next.js Route Handler is intercepted by webpack's static
  module resolution and returns a bundler-internal identifier, not a real filesystem path. No unit
  test touches Next's bundler, so nothing caught it.
- **How to apply:** when a package's README shows a specific integration snippet involving `fs`,
  `require.resolve`, or bundler-adjacent code, that snippet needs to actually run inside the real
  target framework's build at least once — a mocked-loader unit test proves the *factory* works,
  not that the *documented usage* works. Prefer shipping the loader as part of the package
  (bundler-external, real runtime resolution) over asking every consumer to hand-roll one.

## Tree-shaking is not a safety net for Node-vs-Edge bundle isolation

- **What happened:** first fix attempt made `loadScriptSource` optional with an internal default
  living in the *same file* (`create-service-worker-handler.ts`) as the rest of `./server`. Build
  succeeded, but `next build` warned `A Node.js module is loaded ('url') which is not supported
  in the Edge Runtime` for `apps/demo/middleware.ts` — which only imports `withGa4Token`, never
  the SW handler.
- **Why:** tsup bundles a whole entry file's reachable code into *one* output file
  (`dist/server/index.js`). Whether an unused export's Node-only imports get tree-shaken out of a
  *consumer's* Edge bundle depends on that consumer's bundler correctly proving the binding is
  unused — not guaranteed, and this project had already been burned by an identical class of bug
  once before (the original "full-relay-singleton pollution of Edge bundle" issue).
- **How to apply:** when a package ships both Edge-safe and Node-only code, put them in genuinely
  separate build entries/output files (separate tsup `entry` keys → separate export subpaths), not
  just separate source files that get bundled together. Verify with a real `next build` of a
  consumer app that imports only the Edge-safe subpath — don't trust warnings-as-non-fatal to mean
  "safe," and don't trust tree-shaking reasoning without an empirical build. See ADR 0001.

## `import.meta.url` + `new URL(...)` can break under a bundler's external-package interop

- **What happened:** even after isolating the fs-touching code into its own bundle,
  `fileURLToPath(new URL("../sw/index.js", import.meta.url))` threw
  `TypeError: The "path" argument must be of type string or an instance of URL. Received an
  instance of URL` at runtime — only inside Next.js, not in a plain `node -e` reproduction.
- **Why:** Next's `serverExternalPackages` runtime interop constructs the `import.meta.url`-derived
  URL-like value from a different JS realm than the one Node's own `fileURLToPath` checks with
  `instanceof URL` — structurally identical, cross-realm-unequal.
- **How to apply:** when a package needs a path relative to its own module inside code that might
  run under a bundler's "external package" interop layer, avoid the `URL` class entirely — do
  plain string manipulation on the `file://`-prefixed `import.meta.url` string instead of
  `new URL()`/`fileURLToPath()`. Verify against the real target bundler, not just plain Node.

## A real production build genuinely differs from `next dev` for e2e purposes

- **What happened:** two of four e2e specs flaked reliably against `next dev`, specifically the
  ones relying on the app's own auto-registration flow (not explicit `register()` calls). Live
  instrumentation (`page.on("framenavigated")`) showed an unexpected second navigation firing
  ~20-30ms after `load`.
- **Why:** `next dev`'s on-demand route compilation (the SW route hadn't been hit yet, so Next
  compiled it lazily, ~700ms) triggers a client-side reload the first time an uncompiled route is
  requested — racing the SW's registration. A production build never does this.
- **How to apply:** for SW/registration-sensitive e2e specs, point Playwright's `webServer` at a
  production build (`next build && next start`), not `next dev` — it's both more reliable and the
  more correct target for validating real browser behavior rather than dev-server hot-reload
  quirks. Budget the extra build time in the `webServer.timeout`.
- **Evidence:** `playwright.config.ts`'s `webServer.command`, `docs/spikes/playwright-browser-e2e.md`
  "Bug #2" section.

## `changeset publish`'s git tag can point at the wrong commit if you don't commit the version bump first

- **What happened:** ran `pnpm run version` → `pnpm run build` → `pnpm run release` in sequence
  without committing the version-bump files (`package.json`, `CHANGELOG.md`) in between. The
  publish step's "Creating git tags" created `@gtmss/ga4-relay@0.1.1` pointing at `HEAD` — which
  at that moment was still the *pre-bump* commit, since the bump files were uncommitted.
- **Why:** `changeset publish` tags whatever `HEAD` is when it runs; it doesn't itself commit the
  version-bump diff.
- **How to apply:** commit the `changeset version` output (the "Version Packages" commit, in
  changesets' own convention) *before* running `changeset publish`, or be prepared to delete and
  recreate the tag afterward (`git tag -d <tag>` then re-tag at the correct commit) as was done
  here. Confirmed correct via `git tag --points-at HEAD` after the fix.
- **Evidence:** commit `81e5643`, tag `@gtmss/ga4-relay@0.1.1`.

---

Candidates to promote into long-term memory (if the project has a memory system):

- [ ] Package bundler-boundary rule: Node-only helper code for a package that also ships
  Edge-safe exports must live in a *separate build entry/output file*, not just a separate source
  file — tree-shaking alone is not a reliable enough guarantee, verify with a real consumer build.
- [ ] Changesets workflow: always commit the "Version Packages" diff before running
  `changeset publish`, to avoid the release git tag pointing at the wrong commit.
