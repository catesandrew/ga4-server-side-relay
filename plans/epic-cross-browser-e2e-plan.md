# Epic — Cross-browser E2E Infra + Coverage Gaps

Status: **pending approval**

## Requirements Summary

Three pieces of confirmed remaining e2e work, grouped as one epic because they
all live in `packages/ga4-relay/e2e/` and all turn on the same root
`playwright.config.ts`:

1. **Firefox/WebKit e2e unblock — architect-review correction: already
   resolved, premise stale.** `docs/spikes/playwright-browser-e2e.md` and
   `FOLLOWUPS.md` both claim firefox/webkit are stuck at stale cached
   versions, but that is no longer true: Playwright is 1.62.1 (wants
   firefox-1538/webkit-2336 per `playwright install --dry-run`), and both are
   present at `/Volumes/dev-ssd/caches/playwright/` with
   `INSTALLATION_COMPLETE`/`DEPENDENCIES_VALIDATED`. Live-verified:
   `playwright test --project=firefox --list` and `--project=webkit --list`
   each enumerate 14 tests in 6 files with no "Executable doesn't exist"
   error. **CBE-1 is therefore a 5-minute verification task, not a real
   unblock** — run `pnpm exec playwright test` across **all** projects
   (rather than `--project=chromium`) and confirm/close the stale claim.
   Closes the "Firefox/WebKit e2e" item in
   `docs/sessions/2026-08-24-ga4-relay-fixes-release/FOLLOWUPS.md`.
2. **SW beacon-capture regression test** (`docs/spikes/sw-beacon-capture.md`,
   M0.2). A dedicated Playwright spec asserting whether the resilience service
   worker's `fetch` handler observes an outgoing `fetch(keepalive)` /
   `navigator.sendBeacon` call issued during page unload. The answer decides
   whether the SW can be promoted from **retry-only** (today's default, taken
   per the main plan's Pre-mortem #1 and implemented by US-016) to a
   **primary capture layer**. The spike doc's own "To unblock" section asks
   for a *standing regression test*, not a one-time probe — the main plan's
   Verification Steps say the same ("M0.2 spike test … re-run as a standing
   regression test once SW role is decided, not just a one-time spike").
3. **Multi-tab concurrent-flush E2E test.** The main plan's M2 Verification
   Steps call for: *"multi-tab concurrent flush producing exactly one
   server-accepted event via dedupe (no client-side coordination assumed)"* —
   the e2e counterpart to step 2.2's explicit design decision that v1 ships
   **no** `navigator.locks`/leader election because server-side dedupe (2.1)
   already absorbs the duplicate. Today only unit tests exist
   (`src/server/dedupe-store.test.ts`, `src/client/queue.test.ts`,
   `src/client/flush.test.ts`); there is no browser-level proof.

Facts gathered from the repo (do not re-ask / re-derive):

- Existing e2e specs: `ac14-coexistence`, `ac16-kill-switch`, `ac27-scope`,
  `consent-controls`, `home-page`, `debug-endpoint`. Shared infra already
  exists: `e2e/helpers.ts` (real `navigator.serviceWorker` wrappers, no
  mocking), `e2e/wait/readiness.ts` (`waitForAttributeValue`,
  `waitForEpochAdvance`, `waitForCookieValue`, `waitForPageSettled`),
  `e2e/page-objects/{BasePage,HomePage}.ts`, and a typed testid catalog
  mirrored at `apps/demo/lib/test-ids/catalog.mirror.ts`.
- `playwright.config.ts` `webServer` runs a **production build**
  (`next build && next start -p 34577`), deliberately — `next dev`'s
  on-demand route compilation triggers a reload that races SW registration.
  Port `34577` was chosen to dodge two known local collisions.
- **A WebKit precedent already exists** (commit `13d0708`):
  `debug-endpoint.spec.ts` carries `test.skip(browserName === "webkit", …)`
  because WebKit enforces `Secure` cookies strictly with no localhost
  exception over plain HTTP, so it silently drops every identity cookie the
  demo sets. Any cross-browser expansion will hit this class of issue again.
- **Duplicate live events are not observable from the client response.**
  `create-collect-handler.ts` `continue`s past a deduped event and still
  returns `200` + the signed identity JSON — byte-identical to a fresh
  accept. The only dedupe signals are `recordTelemetry({ type: "deduped" })`
  (a `console.log` JSON line with `ga4_relay_telemetry: true`) and the
  *absence* of an outbound MP call. So item 3 needs an observation surface
  before it can assert anything.
- **The demo app currently cannot dedupe at all.** `apps/demo/lib/relay.ts`
  `buildStore()` returns `UpstashStore` whenever both `UPSTASH_REDIS_REST_*`
  are set, and `apps/demo/.env.local` sets both to *placeholders*
  (`https://example…`). Every `setNX` therefore throws →
  `checkAndMarkDedupe` returns `storeUnavailable: true` → live (non-replay)
  events **fail open** (by design, see the handler's comment) → nothing is
  ever deduped. A multi-tab dedupe assertion written today would be vacuous.
- **And the obvious fix is blocked by a guard.** `create-relay.ts`
  `assertValidConfig` throws when `config.store instanceof InMemoryStore &&
  process.env.NODE_ENV === "production"` — and the e2e webServer *is* a
  production build. So simply unsetting the Upstash vars makes `next build`
  fail. This is a real constraint the plan must route around, not ignore.
- `RelayConfig` already has a first-class `endpointBaseOverride`
  ("Test-only: overrides the MP endpoint base so integration tests hit a mock
  server"), and `packages/ga4-relay/test/mock-mp-server.ts` already
  implements a capturing mock of `/mp/collect` + `/debug/mp/collect`. Neither
  is wired into `apps/demo` today.
- Root scripts: `pnpm test:e2e` → `playwright test`. Sibling epic plans live
  alongside this one (`epic-ci-release-infra-plan.md`,
  `epic-adr-documentation-plan.md`, `epic-m0-live-verification-plan.md`).
- `website/blog/2026-08-24-*.md` holds **copies** of every `docs/spikes/*.md`
  file (Docusaurus migration, commit `eaf5cd4`). Updating a spike doc leaves
  its blog copy stale unless updated in the same pass.

### Dependency ordering (confirmed / refined)

The lead's proposed ordering was item 2 depends on item 1, item 3 independent.
Confirmed for item 3. **Refined for item 2**: rather than serialize the whole
of item 2 behind item 1, split it —

- Authoring the beacon-capture spec and getting a **Chromium** verdict needs
  nothing from item 1 and can start immediately (CBE-4).
- The **promotion decision** genuinely cannot be made from Chromium alone:
  Chromium is the one engine with Background Sync, so it is the engine where
  the SW's role matters *least*. The whole point of promoting the SW to a
  capture layer is covering Firefox/WebKit, which have no Background Sync and
  fall back to flush-on-load/online. A Chromium-only "yes" would be evidence
  about the wrong browsers. So the verdict step (CBE-5) hard-depends on CBE-1.

Net: `CBE-1 → CBE-2 → CBE-3` (item 1 chain), `CBE-4 → CBE-5` with
`CBE-5` also requiring `CBE-1`, and `CBE-6 → CBE-7` fully independent of both.

## Acceptance Criteria

1. `pnpm exec playwright install firefox webkit` completes, **or** the epic
   records an explicit environment-blocked verdict with the exact failing
   command and error, escalated to a human with a fresh browser cache.
2. `pnpm exec playwright test` (no `--project` filter) runs all three
   projects and every resulting failure is classified as one of: (a) a real
   product bug → fixed; (b) a documented environment limitation → a
   `test.skip(browserName === …, "<reason>")` with a comment following
   `debug-endpoint.spec.ts`'s precedent; (c) a test-harness bug → fixed in
   the spec/helper. No failure is left unclassified and no blanket skip is
   added without a stated reason.
3. `docs/spikes/playwright-browser-e2e.md` no longer claims "chromium is the
   only project currently runnable here", and the Firefox/WebKit bullet is
   removed from `FOLLOWUPS.md`'s "Blocked on work". The matching
   `website/blog/2026-08-24-playwright-browser-e2e.md` copy is updated in the
   same pass.
4. A new spec `packages/ga4-relay/e2e/sw-beacon-capture.spec.ts` exists that,
   using only real browser APIs (no mocking, consistent with `helpers.ts`),
   fires a `fetch(…, { keepalive: true })` / `navigator.sendBeacon` during a
   real unload and asserts, deterministically, whether the resilience SW's
   `fetch` handler observed it — reporting a definite observed/not-observed
   result per engine rather than passing vacuously on a timeout.
5. That spec runs green (as a *standing regression test*, i.e. it asserts the
   engine's current documented behavior, not merely "does not crash") on
   `chromium`, and — once AC1/AC2 hold — on `firefox` and `webkit` too.
6. `docs/spikes/sw-beacon-capture.md` is updated from "blocked in this
   environment" to a recorded per-engine verdict plus an explicit
   **promote / keep retry-only** decision, with the blog copy updated too. If
   the verdict is "keep retry-only", that is stated as a confirmed finding
   rather than a still-open default assumption.
7. `apps/demo` is configured so an e2e run has a **genuinely functioning
   shared dedupe store** (`checkAndMarkDedupe` returns
   `storeUnavailable: false`) under `NODE_ENV=production`, without weakening
   `create-relay.ts`'s in-memory-store-in-production guard for real
   consumers.
8. `apps/demo` routes outbound MP traffic through
   `RelayConfig.endpointBaseOverride` when an e2e-only env var is set, so a
   spec can count how many `/mp/collect` calls a given `event_id` produced.
   The override is inert (real Google endpoints) when that env var is absent.
9. A new spec `packages/ga4-relay/e2e/multi-tab-dedupe.spec.ts` opens two
   real tabs in one browser context, drives both to flush the **same**
   `event_id` concurrently with no client-side coordination, and asserts
   **exactly one** server-accepted event reached MP — proving the M2
   Verification-Steps claim in a browser rather than in a unit test.
10. `pnpm exec playwright test` passes end-to-end at the close of the epic,
    with the per-browser skip list documented and justified.

## Implementation Steps

Each numbered step below is sized to be one `bd` issue. Titles are the
imperative issue titles; `Blocked on:` is the classification;
`Depends on:` is the hard ordering constraint.

---

### CBE-1 — Verify Firefox/WebKit Playwright binaries (already installed)

**Blocked on:** nothing — **architect-review correction: demoted from an
install task to a 5-minute verification task.** Firefox-1538 and
webkit-2336 (the exact versions Playwright 1.62.1 wants) are already present
at `/Volumes/dev-ssd/caches/playwright/` with `INSTALLATION_COMPLETE` and
`DEPENDENCIES_VALIDATED` markers — the "stale cache" premise in
`docs/spikes/playwright-browser-e2e.md`/`FOLLOWUPS.md` is out of date. No
escalation gate, no blocked-on-user branch, no download risk: this is a
verify-and-document step.
**Depends on:** nothing.

Run from repo root:

```sh
pnpm exec playwright install --dry-run   # confirm resolved versions/paths, no download expected
pnpm exec playwright test --project=firefox --list
pnpm exec playwright test --project=webkit --list
```

If (unexpectedly) either `--list` fails with "Executable doesn't exist", *then*
fall back to `pnpm exec playwright install firefox webkit` and treat a
download failure as blocked-on-user — but do not assume this path; verify
first.

**Acceptance criteria**
- `pnpm exec playwright test --project=firefox --list` and
  `--project=webkit --list` both enumerate specs without a "browser is not
  installed" / "Executable doesn't exist" error (expected outcome, already
  confirmed once during architect review).
- No change to `playwright.config.ts` — the three projects are already
  declared; this issue only verifies binaries.

---

### CBE-2 — Run the full e2e suite on all three projects and triage every failure

**Blocked on:** work.
**Depends on:** CBE-1.

```sh
pnpm exec playwright test            # all projects, NOT --project=chromium
```

Triage each failure into exactly one bucket and act accordingly:

- **(a) Real product bug** — fix it in `packages/ga4-relay/src/**` (and add
  a unit test alongside, matching the repo's existing
  `*.test.ts`-next-to-source convention). Precedent: the SW-route 500 found
  by the original Chromium pass was a real bug affecting every consumer.
- **(b) Environment limitation** — add a narrow
  `test.skip(browserName === "<engine>", "<one-line reason>")` plus a comment
  explaining *why*, following the shape already used in
  `debug-endpoint.spec.ts`. The known first candidate: **WebKit drops
  `Secure` cookies over `http://localhost`**, so every identity-cookie
  assertion (`consent-controls.spec.ts`, `home-page.spec.ts`'s tracking
  assertions, anything using `waitForCookieValue`) is likely to fail on
  WebKit for the same reason `debug-endpoint.spec.ts` already skips.
- **(c) Test-harness bug** — fix the spec, page object, or helper. Prefer
  fixing the shared helper over duplicating a per-engine workaround inline;
  `waitForRegistrationActive`'s `active?.state === "activated"` check is the
  existing example of a correctness fix that belongs in the helper.

Do **not** widen an existing Chromium-green assertion just to make another
engine pass; if the assertion is genuinely correct and the engine genuinely
cannot satisfy it, that is bucket (b), not a weaker assertion.

**Acceptance criteria**
- A written triage table (in the issue, then folded into CBE-3's doc update)
  listing every failing `spec × project` pair and its bucket.
- Every bucket-(a) fix has a unit test; every bucket-(b) skip has a
  `browserName` guard and a stated reason; no `test.skip()` without a reason
  string, and no `test.only` / `.fixme` left in the tree.
- `pnpm exec playwright test` exits 0 with all three projects enabled.

---

### CBE-3 — Update the e2e spike doc and FOLLOWUPS to reflect cross-browser status

**Blocked on:** work.
**Depends on:** CBE-2.

Update `docs/spikes/playwright-browser-e2e.md`: replace the "Firefox/webkit are
present in the cache but at stale versions … `chromium` is the only project
currently runnable here" paragraph with the real post-CBE-2 status, and add a
short "Per-engine coverage" section carrying CBE-2's triage table (which specs
are green on which engines, and which are skipped and why).

Remove the "Firefox/WebKit e2e" bullet from
`docs/sessions/2026-08-24-ga4-relay-fixes-release/FOLLOWUPS.md`'s "Blocked on
work" list (or move it to "Done", matching that file's existing convention).

Mirror both edits into `website/blog/2026-08-24-playwright-browser-e2e.md` —
that file is a *copy*, not a symlink, so it silently goes stale otherwise.

**Acceptance criteria**
- `grep -n "only project currently runnable"` returns nothing under `docs/`
  or `website/`.
- `FOLLOWUPS.md`'s "Blocked on work" no longer lists Firefox/WebKit e2e.
- `cd website && pnpm build` still succeeds (`onBrokenLinks: 'throw'`).

---

### CBE-4 — Add a Chromium SW beacon-capture regression spec

**Blocked on:** work.
**Depends on:** nothing (deliberately *not* CBE-1 — see "Dependency ordering").

Write `packages/ga4-relay/e2e/sw-beacon-capture.spec.ts`, authored
cross-browser-ready from the start (no Chromium-only APIs in the test body,
so CBE-5 is a run, not a rewrite):

- Register the resilience SW at `RESILIENCE_SW_SCOPE_PATH` and wait via the
  existing `waitForRegistrationActive` helper (real API, no mocking).
- Establish a **positive control** first: issue a normal in-page
  `fetch(keepalive: true)` to a URL inside the SW's scope while the page is
  alive, and confirm the SW's `fetch` handler reports it. If the control
  fails, the unload result is meaningless — fail loudly rather than
  concluding "not observed".
- Then trigger a **real** unload (navigate away / close the tab), with the
  beacon issued from a `pagehide`/`visibilitychange` handler — the actual
  browser lifecycle, not a synthetic dispatch.
- Have the SW record observations somewhere that survives the unloading page:
  a same-scope endpoint hit, a `Cache` entry, or an IndexedDB record read
  back from a *fresh* page after the unload. Do not rely on
  `postMessage` back to a page that is being torn down.
- Assert a **definite** outcome. A test that merely times out waiting for an
  observation and calls that "not observed" is a false negative generator —
  drive the assertion off the positive control plus a bounded, documented
  settle window, and make the two cases distinguishable in the failure
  message.

Add the shared bits (SW-observation readback, unload trigger) to
`e2e/helpers.ts` rather than inlining them, so CBE-5 and any future spec reuse
them.

**Acceptance criteria**
- `pnpm exec playwright test --project=chromium sw-beacon-capture` passes and
  produces a recorded, non-vacuous observed/not-observed result for Chromium.
- The positive control fails the test if the SW's `fetch` handler is not
  wired up at all — verified by temporarily breaking it once during
  development.
- Zero mocking of `navigator.serviceWorker`, `fetch`, or `sendBeacon`; every
  call goes through the real browser API via `page.evaluate`, consistent with
  the rest of `e2e/`.
- Spec is stable across 5 consecutive runs (`--repeat-each=5`).

---

### CBE-5 — Run beacon-capture cross-browser and record the SW promote/retry-only verdict

**Blocked on:** work.
**Depends on:** CBE-4 (CBE-1 is now a trivial verification step per its
correction above, not a real blocker, but the ordering is unchanged — this
step still needs firefox/webkit confirmed runnable first).

```sh
pnpm exec playwright test sw-beacon-capture   # all three projects
```

Record the per-engine result (Chromium / Firefox / WebKit), then make the
decision the spike exists to make:

- **Promote to primary capture layer** only if *all three* engines observe the
  unload beacon in the SW `fetch` handler. Anything less and the SW cannot be
  the primary layer, because the layer's value is precisely the engines
  without Background Sync.
- Otherwise **confirm retry-only** — which is already what US-016 implements,
  so this outcome is a *confirmation*, not a change: the plan's Pre-mortem #1
  default becomes an evidence-backed decision instead of a safe assumption.

Rewrite `docs/spikes/sw-beacon-capture.md`: drop "Status: blocked in this
environment", add the per-engine result table, the verdict, and what would
change if the verdict were revisited. Mirror into
`website/blog/2026-08-24-sw-beacon-capture.md`. Remove the
`sw-beacon-capture.md` bullet from `FOLLOWUPS.md`'s "Blocked on work".

If the verdict is "promote", **do not implement the promotion in this issue** —
file it as a separate follow-up. This issue's deliverable is the evidence and
the decision, not the SW rearchitecture.

**Acceptance criteria**
- Per-engine result recorded for all three projects.
- `docs/spikes/sw-beacon-capture.md` states a verdict, not a default
  assumption; blog copy matches.
- The spec remains in the suite as a standing regression test (it is not
  deleted after the verdict) — this is explicitly what the main plan's
  Verification Steps ask for.
- No SW behavior change lands in this issue.

---

### CBE-6 — Make dedupe and MP delivery observable from e2e in the demo app

**Blocked on:** work.
**Depends on:** nothing. Prerequisite for CBE-7.

Two pieces of plumbing, both confined to `apps/demo` + config surface already
designed for it. **No product behavior changes** in `packages/ga4-relay/src/`.

*(a) A working shared dedupe store under a production build.* Today
`buildStore()` returns `UpstashStore` because `.env.local` sets placeholder
`UPSTASH_REDIS_REST_*` values, so every `setNX` throws and live events fail
open — dedupe never fires. Unsetting those vars is not sufficient, because
`create-relay.ts` (`packages/ga4-relay/src/server/create-relay.ts` — not
`src/create-relay.ts`) throws on `InMemoryStore` under
`NODE_ENV=production` and the e2e webServer runs `next build && next start`.
Two viable routes:

- **Preferred, and resolved by architect review — use this one:** add a
  small demo-local `Store` implementation in `apps/demo/lib/` that is a
  distinct class and **explicitly not a subclass of `InMemoryStore`** (the
  guard is `config.store instanceof InMemoryStore`, which is also true for
  subclasses — a plain, unrelated class passes untouched), used only when an
  e2e-only env var is set. `next start` is a single Node process, so a
  process-local map is a correct shared store for the duration of one e2e
  run. This resolves the "which store route" open question below in favor of
  the demo-local class.
- **Alternative (not chosen):** stand up a real Upstash-REST-compatible
  endpoint locally (e.g. an `srh`/serverless-redis-http container) as a
  second `playwright.config.ts` `webServer` entry. Higher fidelity, heavier
  setup and a new external dependency for every contributor — not worth it
  for this epic's purpose.

**Rate-limiting side effect (architect-review addition):** `checkRateLimit`
swallows store errors (`store.ts:108`), so today's throwing placeholder
Upstash store makes rate limiting an inert no-op in e2e. Switching to a
working store activates a **real 120-events/60s-per-`kid`** limit across
`fullyParallel` × 3 projects × `--repeat-each=5` — enough concurrent runs to
plausibly trip it. Add an explicit AC: either configure a generous
e2e-only `rateLimit` override, or assert no spec run produces a 429.

*(b) A countable MP sink.* Wire `RelayConfig.endpointBaseOverride` (already a
first-class, documented test-only field) into `apps/demo/lib/relay.ts` from an
e2e-only env var. **Architect-review correction: a thin wrapper around
`packages/ga4-relay/test/mock-mp-server.ts` is mandatory, not optional.** The
mock server as it exists is an in-process function listening on port 0 that
exposes captures as a plain JS array with no HTTP readback route — it cannot
itself be a `playwright.config.ts` `webServer` (which needs a fixed port and
an external readiness/readback signal). Build the wrapper: a fixed port, plus
a `GET /__e2e/requests` route returning the captured `/mp/collect` payloads
as JSON, then add it as an additional `webServer` entry. When the e2e env var
is absent, the override must be `undefined` and traffic must go to Google's
real endpoints exactly as today. **Correlation-key correction (architect
review):** `event_id` is a **sibling of `params`** on `Ga4Event`
(`src/shared/event.ts:12`), and `buildMpPayload` forwards only `name` +
`params` (`mp-client.ts:86-98`) — **`/mp/collect` payloads carry no
`event_id` field at all.** A spec cannot "count how many `/mp/collect` calls
carried `event_id: X`" as originally phrased. Correlate instead on a
spec-injected `params.e2e_correlation_id` (a unique value set by the test),
or on a unique event `name` per test run — the wrapper's readback route
should expose whichever key the spec actually queries on.

**Acceptance criteria**
- With the e2e env var set and a production build running:
  `checkAndMarkDedupe` returns `storeUnavailable: false` (assert indirectly —
  two identical-`params.e2e_correlation_id` posts to `/api/ga4/collect` yield
  exactly one `/mp/collect` at the mock wrapper's `GET /__e2e/requests`
  readback).
- No e2e run in the suite (`fullyParallel` × 3 projects × `--repeat-each=5`)
  produces a 429 from the now-live rate limiter, or an explicit generous
  e2e-only `rateLimit` override is configured and documented.
- With the env var absent: `endpointBaseOverride` is `undefined`,
  `buildStore()` behaves exactly as it does today, and `pnpm --filter demo
  build` still succeeds — verified by diffing behavior, not assumed.
- `create-relay.ts`'s `assertValidConfig` is **unchanged**; the guard still
  throws for a real consumer passing `InMemoryStore` in production; the new
  demo-local store class is confirmed **not** a subclass of `InMemoryStore`.
- `apps/demo/.env.example` documents the new e2e-only var(s) and states
  plainly that they are test-only.
- Root `pnpm test` and `pnpm typecheck` still pass.

---

### CBE-7 — Add the multi-tab concurrent-flush dedupe e2e spec

**Blocked on:** work.
**Depends on:** CBE-6.

Write `packages/ga4-relay/e2e/multi-tab-dedupe.spec.ts`, implementing the main
plan's M2 Verification Step verbatim: *multi-tab concurrent flush producing
exactly one server-accepted event via dedupe, no client-side coordination
assumed.*

- Open **two real pages in one `BrowserContext`** (shared cookies + shared
  IndexedDB origin — the actual multi-tab condition step 2.2 describes), not
  two isolated contexts.
- Get the same event (sharing one `params.e2e_correlation_id` — see CBE-6(b)'s
  correlation-key correction; `/mp/collect` payloads carry no `event_id`
  field) queued and flushed from both tabs at once. Prefer driving this
  through the real client SDK's queue/flush path (offline → queue → online →
  both tabs flush) over hand-posting to `/api/ga4/collect`; a hand-rolled
  post proves the dedupe store works but not that the *SDK's* uncoordinated
  multi-tab flush is absorbed, which is the actual claim.
- Assert **exactly one** `/mp/collect` reached the mock MP server's
  `GET /__e2e/requests` readback for that `e2e_correlation_id` — the only
  unambiguous signal, since the collect handler returns an identical `200` +
  identity body for both the accepted and the deduped request.
- Explicitly assert that no client-side coordination is required: the spec
  must **not** use `navigator.locks` or leader election, and should say so in
  a comment, because that absence is the design decision under test.
- Use the existing `waitForEpochAdvance` / `waitForAttributeValue` readiness
  helpers rather than `waitForTimeout` for every settle.

Runs under `chromium` alone; it is independent of CBE-1/CBE-2. If it is later
extended cross-browser, note that WebKit will need the same
`Secure`-cookie-over-`http://localhost` skip that `debug-endpoint.spec.ts`
already carries.

**Acceptance criteria**
- `pnpm exec playwright test --project=chromium multi-tab-dedupe` passes.
- **Anti-vacuity check (architect-review correction — the original framing
  was backwards).** `create-collect-handler.ts:188` computes
  `treatAsDuplicate = storeUnavailable ? isReplay : isDuplicate` — when the
  store is unavailable, **replays fail closed**, so disabling the store
  entirely makes the flush path yield **zero** `/mp/collect` calls, not two.
  The correct anti-vacuity check requires a *working* store: verify once
  during development that with the dedupe key pre-cleared (or with two
  distinct `e2e_correlation_id`s instead of a shared one), the assertion
  correctly goes to **two** `/mp/collect` calls — proving the test can
  distinguish "deduped" from "nothing was ever sent."
- Assertion is on the MP-side call count via the mock wrapper's
  `GET /__e2e/requests` readback, not on HTTP status codes from
  `/api/ga4/collect` (which are identical either way).
- No `navigator.locks` / leader-election code appears in either the spec or
  `packages/ga4-relay/src/client/`.
- Stable across 5 consecutive runs (`--repeat-each=5`).

## Risks and Mitigations

- **Risk (superseded by architect review):** the original concern was that a
  browser-binary download might be blocked on this sandboxed machine. Verified
  false — firefox/webkit are already installed and runnable, so CBE-1 carries
  no download risk. Retained only as a documented fallback in CBE-1 if a
  future environment genuinely lacks the binaries.
- **Risk:** enabling `firefox`/`webkit` turns a green 3-browser suite into a
  wall of red and the reflex is a blanket `test.skip`. **Mitigation:** CBE-2
  mandates a per-failure triage bucket with a stated reason; a skip without a
  `browserName` guard and reason string fails that issue's AC.
- **Risk:** the WebKit `Secure`-cookie-over-HTTP limitation affects far more
  specs than `debug-endpoint.spec.ts`, and the "right" fix (serve e2e over
  HTTPS) is a much bigger change than this epic. **Mitigation:** treat HTTPS
  as explicitly out of scope; document skips per the existing precedent and
  raise HTTPS-for-e2e as a separate follow-up if the skip count is large.
- **Risk:** the beacon-capture spec passes vacuously — the SW never observes
  anything because it was never correctly registered, and the test reads that
  as a clean "not observed". **Mitigation:** CBE-4's mandatory positive
  control, verified by deliberately breaking the handler once.
- **Risk:** the multi-tab spec passes vacuously — exactly one MP call arrives
  because the second tab never flushed at all, not because dedupe absorbed it.
  **Mitigation:** CBE-7's anti-vacuity check (disable dedupe, confirm the
  count goes to two).
- **Risk:** the CBE-6 test-only plumbing (`endpointBaseOverride`, an e2e
  store) leaks into a real deployment path. **Mitigation:** both are gated on
  an env var that is absent by default; CBE-6's AC requires verifying the
  unset path is byte-for-byte today's behavior, and `create-relay.ts`'s
  production guard is explicitly left untouched.
- **Risk:** spike-doc edits land in `docs/spikes/` but not in the
  `website/blog/` copies, so the published site keeps saying "blocked".
  **Mitigation:** CBE-3 and CBE-5 both name the blog file explicitly in their
  ACs, and CBE-3 re-runs `cd website && pnpm build`.
- **Risk:** the e2e webServer already runs a full `next build` per invocation
  and adding a mock-MP `webServer` plus more projects makes the suite slow
  enough that people go back to `--project=chromium`. **Mitigation:** note
  runtime in CBE-2; if it becomes a problem, that is a CI-sharding question
  for `epic-ci-release-infra-plan.md`, not a reason to narrow coverage here.

## Verification Steps

1. `pnpm exec playwright install --dry-run` — firefox and webkit resolve to
   versions matching the installed Playwright, with real cache paths.
2. `pnpm exec playwright test` (no project filter) — exits 0; the run summary
   shows all three projects, with the skip count matching CBE-2's documented
   triage table.
3. `pnpm exec playwright test sw-beacon-capture --repeat-each=5` — passes on
   every enabled engine, with the per-engine observed/not-observed result
   printed or recorded.
4. `pnpm exec playwright test multi-tab-dedupe --project=chromium
   --repeat-each=5` — passes; the anti-vacuity variant (dedupe disabled) is
   confirmed to fail.
5. `pnpm --filter demo build` with the e2e env vars **unset** — succeeds, and
   `apps/demo/lib/relay.ts` resolves `endpointBaseOverride` to `undefined`.
6. `pnpm test && pnpm typecheck && pnpm lint` — all pass.
7. `grep -rn "test.skip\|test.only\|test.fixme" packages/ga4-relay/e2e/` —
   every hit is a `browserName`-guarded skip with a reason string; zero
   `.only` / `.fixme`.
8. `cd website && pnpm build` — succeeds after the spike-doc/blog updates.
9. `docs/sessions/2026-08-24-ga4-relay-fixes-release/FOLLOWUPS.md` — neither
   "Firefox/WebKit e2e" nor "sw-beacon-capture.md" remains under "Blocked on
   work".

## Open Questions (flag, don't guess)

- **CBE-6(a): which dedupe-store route? — resolved by architect review.** The
  demo-local single-process `Store` class is the chosen route (simple, no new
  external dependency, correct for a single `next start`, and confirmed
  `instanceof InMemoryStore` is false for an unrelated class so the
  production guard stays untouched). The Upstash-REST-compatible-container
  alternative is not pursued — flag only if you'd rather pay for that
  fidelity later.
- **CBE-5: what happens if the verdict is "promote"?** This plan deliberately
  stops at evidence + decision and files the SW rearchitecture separately,
  since promoting the SW to a primary capture layer is a materially larger
  change than an e2e epic should absorb. Confirm that split is what you want.
- **WebKit over HTTPS.** If CBE-2's triage shows most WebKit failures trace to
  the `Secure`-cookie-over-`http://localhost` limitation, is serving the e2e
  webServer over HTTPS (self-signed cert + `ignoreHTTPSErrors`) in scope for a
  follow-up, or is a documented WebKit skip list the accepted end state?
- **CI.** `epic-ci-release-infra-plan.md` owns adding GitHub Actions. Should
  the 3-browser Playwright run be part of that workflow from day one (slower
  PRs, real cross-browser signal) or a nightly/manual job? Not decided here.

## Changelog

- Initial draft. Scope taken as confirmed from `FOLLOWUPS.md` "Blocked on
  work", `docs/spikes/sw-beacon-capture.md`, and the main plan's M2
  Verification Steps; not re-derived. Refined the lead's proposed ordering by
  splitting item 2 into CBE-4 (Chromium, independent) and CBE-5 (cross-browser
  verdict, depends on CBE-1) — reasoning in "Dependency ordering". Added CBE-6
  as a discovered prerequisite for item 3: the demo app cannot currently
  dedupe at all (placeholder Upstash creds → store unavailable → live events
  fail open) and duplicates are invisible in the collect response, so the
  multi-tab assertion has no observation surface without it.
