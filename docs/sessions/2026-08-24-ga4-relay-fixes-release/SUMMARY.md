# Summary — GA4 relay live-verification fixes + 0.1.1 release (2026-08-24)

## Goal

Take `@gtmss/ga4-relay` (already publicly published as `0.1.0`) and actually verify it against
real infrastructure — a live GA4 property and a real browser — rather than only unit/mock
coverage, fix whatever that verification found, and add changelog/versioning tooling.

## What was done

### Made the package a public GitHub repo + public npm package (earlier this session)

- Renamed the npm scope `@gtm-server-side` → `@gtmss` across 8 files (`e96d549`).
- Added `LICENSE` (MIT), `packages/ga4-relay/README.md` (copy of root README for the npm page),
  `publishConfig.access: public` (`e96d549`).
- Created `github.com/catesandrew/ga4-server-side-relay` (public), pushed.
- Published `@gtmss/ga4-relay@0.1.0` to the public npm registry, confirmed live.

### Live GA4 verification found and fixed a real MP-payload bug

- Sent real Measurement Protocol events at a real property (`catesworks.dev`, GA4 property
  551179302) via the package's own `buildMpPayload`/`collectUrl`/`debugCollectUrl` shape, hitting
  both `/debug/mp/collect` and the real `/mp/collect` endpoint.
- GA4's own debug validator flagged `NAME_DUPLICATED`: `buildMpPayload` sent both a manual
  `session_id` param **and** `ga_session_id` — GA4 canonicalizes `ga_session_id` to the same
  internal session field, so the two collided.
- Fixed in `packages/ga4-relay/src/server/mp-client.ts` (only `ga_session_id`/`ga_session_number`/
  `engagement_time_msec` are sent now); added a regression test in
  `packages/ga4-relay/src/server/mp-client.test.ts`. Confirmed live: the corrected payload showed
  up in `catesworks.dev`'s Realtime "Event count by Event name" report within ~30-60s.
- `ip_override` (AC30) check was inconclusive — two events sent with `ip_override: "8.8.8.8"`
  never appeared in Realtime, most likely GA4 bot-filtering a well-known datacenter IP, not a
  code defect. Documented as still-open in `docs/spikes/mp-fidelity.md`.
- Commit: `26c805e`.

### Real browser Playwright e2e found and fixed a real SW-route bug

- `pnpm exec playwright install chromium` succeeded this session (prior attempts in this
  environment had failed with 0 outbound network access — that constraint no longer applies).
- Wrote real e2e specs against `apps/demo` exercising the actual `navigator.serviceWorker` API,
  no mocking: `packages/ga4-relay/e2e/ac14-coexistence.spec.ts`, `ac16-kill-switch.spec.ts`,
  `ac27-scope.spec.ts`, `helpers.ts`.
- **Bug found:** `GET /ga4-relay/ga4-sw.js` returned `500` in both `next dev` and
  `next build && next start`. Root cause: the documented pattern
  `createRequire(import.meta.url).resolve("@gtmss/ga4-relay/sw-script")` is intercepted by
  Next.js's Route Handler bundling and never returns a real filesystem path — this affected every
  real consumer following the README, not just the demo app.
- **Fix:** moved script-loading into the package itself. Added `loadBundledSwScript` at a new
  `@gtmss/ga4-relay/server/sw-script-loader` subpath (`packages/ga4-relay/src/server/sw-script-loader.ts`),
  built as a **separate tsup entry/output file** from `./server` specifically so its `node:fs`
  usage can never land in the same bundle as `withGa4Token`, which Edge middleware imports from
  `./server` (`packages/ga4-relay/tsup.config.ts`, `packages/ga4-relay/package.json`'s new
  `./server/sw-script-loader` export). See ADR 0001.
- **Second bug this surfaced:** `fileURLToPath(new URL(...))` threw
  `TypeError: Received an instance of URL` under Next's `serverExternalPackages` interop — a
  cross-realm `instanceof URL` mismatch. Fixed by avoiding the `URL` class entirely — plain string
  manipulation on the `file://`-prefixed `import.meta.url`.
- **Also fixed (found live while investigating, unrelated to the two bugs above):** React's App
  Router dev mode double-invokes effects, which would call `Ga4Init`'s `createGa4Client()` (and
  thus `registerServiceWorker()`) twice per mount. Guarded with a module-level flag in
  `apps/demo/app/ga4-init.tsx` and the root README's usage example, since real consumers copying
  that exact snippet would hit it too.
- **Test-environment finding (not a product bug):** `next dev`'s on-demand route compilation
  triggers a client-side reload the first time an uncompiled route is hit, racing SW activation.
  Switched `playwright.config.ts`'s `webServer` to a production build — also the more correct e2e
  target. One further single-read timing flake (root cause not conclusively isolated) was fixed
  by hardening `ac27-scope.spec.ts`'s assertion to poll-and-reconfirm a stable active state
  instead of trusting one instantaneous read.
- All 4 specs pass against real Chromium: `pnpm exec playwright test --project=chromium`.
- Full detail: `docs/spikes/playwright-browser-e2e.md` (rewritten this session).
- Commit: `26c805e`.

### Changesets + 0.1.1 release

- Added Changesets (`.changeset/config.json`, root `package.json` scripts `changeset`/`version`/`release`,
  `packages/ga4-relay/CHANGELOG.md` seeded for `0.1.0`) (`26c805e`).
- Two changesets authored for the two fixes above, consumed via `pnpm run version` → `0.1.1`.
- Built, tested, published: `pnpm run release` → `@gtmss/ga4-relay@0.1.1` live on the public npm
  registry (confirmed via `npm view @gtmss/ga4-relay version` → `0.1.1`).
- Committed the version bump (`81e5643` "Version Packages"), tagged `@gtmss/ga4-relay@0.1.1`
  **at the correct commit** (changesets' own tag creation had pointed at the pre-bump commit —
  deleted and recreated after committing the bump, see LESSONS.md), pushed both.

## Verification

- Tests: `pnpm exec vitest run` → 21 files, **167/167 passed** (was 165 at session start; +1 for
  the `mp-client.ts` fix's regression test, +1 for the new `sw-script-loader.test.ts`).
- Typecheck: `pnpm run typecheck` → clean, no errors.
- Lint: `pnpm exec eslint .` → clean, no output.
- Package build: `pnpm --filter @gtmss/ga4-relay build` → clean, 3 tsup targets + the new
  `sw-script-loader` entry, all DTS generated.
- Demo prod build: `rm -rf apps/demo/.next && pnpm --filter demo build` → clean, middleware
  35.1 kB (matches pre-bug-introduction baseline, confirming no Edge-runtime Node-module leak).
- Live browser e2e: `pnpm exec playwright test --project=chromium` → **4/4 passed** against real
  Chromium (Chrome for Testing 151.0.7922.34), real `navigator.serviceWorker` API, no mocking.
- Live GA4: real MP events sent to a real property, confirmed in Realtime via Chrome DevTools MCP
  browsing the actual GA4 UI (signed-in session), not just HTTP status codes.
- npm registry: `npm view @gtmss/ga4-relay version` → `0.1.1`, confirmed live post-publish.
- Not verified: Firefox/WebKit e2e (stale cached browser versions vs. what this Playwright wants —
  only `chromium` project runnable in this environment); `ip_override`'s geo-dimension effect
  (inconclusive test IP); Traffic-acquisition/Engagement report settling (needs 48h+); Safari ITP
  cookie longevity (needs 8+ day real observation); Google's native first-party mode (needs a real
  Vercel deployment).

## Commits

| SHA | Repo | Message | Pushed? |
|-----|------|---------|---------|
| `712dd8f` | gtm-server-side | Add GA4 server-side relay package for Next.js/Vercel | yes |
| `e96d549` | gtm-server-side | Rename package scope to @gtmss and prep for public release | yes |
| `26c805e` | gtm-server-side | Fix two live-verified bugs; add changesets tooling and SW e2e coverage | yes |
| `81e5643` | gtm-server-side | Version Packages (0.1.1) | yes |

Tag `@gtmss/ga4-relay@0.1.1` → `81e5643`, pushed.

## Out of scope / deferred

See `FOLLOWUPS.md` — all deferred items are pre-existing environment-blocked spikes
(`docs/spikes/*.md`), not new gaps introduced this session.
