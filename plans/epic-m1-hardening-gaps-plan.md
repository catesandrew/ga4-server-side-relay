# Epic: M1 Hardening Gaps

Status: **pending approval**

## Requirements Summary

M1 (core relay) of `.omc/plans/ga4-server-side-relay-plan.md` is otherwise
implemented and tested. Three hardening criteria remain unmet. This plan
covers only those three, sized into discrete units suitable for individual
`bd` issues.

The three gaps:

1. **Client bundle-size budget** — the relay plan caps the client SDK's
   gzipped bundle at **5KB in v1, "CI-enforced via a bundle-size check"**
   (relay plan step 1.9). No `size-limit`/`bundlesize`/any size check
   exists in `packages/ga4-relay` today, and nothing enforces it in CI.
2. **Load test (AC18)** — *"Relay p99 latency from request-in to
   MP-request-issued is under 2s at 50 RPS load-test (burst; not a
   steady-state SLA), measured via a load-test harness that distributes
   distinct `kid`-keyed tokens across simulated virtual users (or uses an
   explicit test-only rate-limit override) so AC29's per-`kid` threshold
   doesn't trip the load test itself."* AC18 further pins the
   **measurement method**: server-side via `telemetry.ts` structured logs
   (timestamp at request-in, timestamp at MP-request-issued inside the
   `after()` callback) — *not* client-side load-tool timings, which only
   see the earlier `204`/JSON response. No load-test tooling exists in the
   repo.
3. **Real-staging geo dimension test (AC30)** — *"`ip_override` in the
   outbound MP payload results in a populated GA4 geo dimension
   (country/region) for a known-IP test request — not just correct
   *sourcing* (AC5) but confirmed *effect*, verified against a **real
   staging GA4 property**, not a mock server."* AC5 (sourcing from
   `x-vercel-forwarded-for`) is already covered by mock-MP-server tests;
   AC30 is the fuller loop and a mock cannot satisfy it.

### Scope boundary with the sibling epic plans (read this first)

Three sibling epic plans were drafted in the same pass and **already own
work this epic would otherwise duplicate**. This plan defers to them
rather than re-filing:

- **`.omc/plans/epic-ci-release-infra-plan.md` Step 1** already owns
  creating `.github/workflows/ci.yml` (install → build → typecheck →
  test). Gap A here does **not** create that workflow — it adds the size
  check *into* it. If that epic slips, A2 below is the standalone
  fallback.
- **`.omc/plans/epic-m0-live-verification-plan.md` Step S3 + decision
  D3** already own the AC30 `ip_override` retest, including the finding
  that the prior attempt (`8.8.8.8`, a datacenter IP) was almost
  certainly **GA4 bot-filtered**, and that a real residential/mobile IP
  is required. **Gap C below is reduced to a single delta issue**, not a
  parallel implementation — see C1. Do not file duplicate AC30 bd issues.
- **`.omc/plans/epic-m0-live-verification-plan.md` Step S1 + decisions
  D1/D2** already own deploying `apps/demo` to a real Vercel project with
  Upstash provisioned. Gap B's deployed-target requirement (B3) consumes
  that deploy rather than introducing a second one.

Net: this epic's genuinely new work is **Gap A (3 issues)** and **Gap B
(3 issues)**, plus **one delta issue for Gap C**.

### Naming correction (do not propagate the mislabel)

The intake brief called the bundle-size budget "AC9". In the relay plan's
numbered acceptance-criteria list, **AC9 is dedupe** (*"Posting the same
client-generated `event_id` twice produces exactly one outbound MP call
(M2, once dedupe store exists)"*) — an M2 item, not this epic. The 5KB
gzip budget is stated in **relay plan step 1.9** (`client-sdk.ts`), not as
a numbered AC. Gap 1 below is therefore referenced as **"step 1.9 bundle
budget"**, not AC9. AC18 and AC30 numbers are correct as given.

### Facts gathered from the repo (not to be re-derived)

- `packages/ga4-relay` builds with **tsup** (`tsup.config.ts`, three
  configs: `dist/server` node/esm, `dist/client` browser/esm,
  `dist/sw` browser/esm). Build script is `"build": "tsup"`. No
  minification is configured, so `dist` is unminified ESM.
- Published client entrypoint is `./client` → `dist/client/index.js`.
- **Architect-review correction to the measured size:** `chunk-7TUJHLLV.js`
  and `queue-OYSWXHXL.js` are **stale build orphans**, not part of the shipped
  entrypoint — they are dated Aug 24 vs. `index.js`'s Aug 29, and `index.js`
  itself contains **zero `import` statements** (its first line is
  `// src/client/queue.ts` — it inlines everything). Root cause:
  `tsup.config.ts` sets `clean: true` on the **server** config only; the
  client and sw configs have none, so `dist/client`/`dist/sw` are never
  cleaned between builds, and `package.json`'s `files: ["dist"]` means those
  orphans are published to npm today. **The real entrypoint is `index.js`
  alone: 3,749 B gzip, ~1.37 KB of headroom against a 5,120 B budget** — not
  4,640 B / <500 B headroom. AC3's "index.js alone vs. plus chunks" question
  is therefore already answered: index.js *is* the whole entrypoint.
- **There is no CI that builds, typechecks, lints, or tests this repo
  today.** `.github/workflows/` contains exactly one file,
  `skills-release.yml` (skills package/marketplace sync + Changesets
  release). Root scripts `build`/`test`/`test:e2e`/`lint`/`typecheck`
  exist but run nowhere in CI. `ci.yml` is owned by the CI epic.
- `src/server/telemetry.ts` `TelemetryEvent` is
  `forwarded | dropped-permanent | rate-limited | consent-denied |
  retried | deduped`. **There is no latency/duration event and no
  request-in timestamp** — `recordTelemetry` stamps only `ts: Date.now()`
  at emit time. AC18's stated measurement method is not currently
  emittable.
- `create-collect-handler.ts` reads `kid` from the verified token payload
  (line ~72) and rate-limits on it (`checkRateLimit(config.store, kid,
  ...)`, line ~110). Token minting is `mintToken(origin, secret)` in
  `src/server/token.ts`, one random `kid` per issuance; cookie name
  `__ga4r_tok`. AC29's documented default is 120 events/min per `kid`.
- `apps/demo` is a real Next.js app (collect route, debug route, SW route,
  middleware, `.env.local`) but is **not deployed anywhere** — it is only
  booted locally by `playwright.config.ts` (production build, port 34577).
- No `k6`/`autocannon`/`artillery` reference exists anywhere in the repo.
- **AC30 prior attempt:** two events were sent with
  `ip_override: "8.8.8.8"` against `catesworks.dev` (property 551179302)
  and the result was **inconclusive — most likely GA4 bot-filtered**,
  because `8.8.8.8` is a well-known datacenter IP
  (`docs/spikes/mp-fidelity.md`, `docs/sessions/2026-08-24-.../
  FOLLOWUPS.md`). Any AC30 retest that reuses a public/datacenter IP will
  reproduce that failure.

### Ordering / dependencies

Gap A, Gap B, and Gap C are **independent of each other** — no cross-gap
blocking. Within each gap the steps are sequential (A1→A3, B1→B2→B3).
Cross-epic dependencies:

```
epic-ci-release-infra S1 (ci.yml) ──→ A3 (size check in CI)
A1 (size-limit config) ───────────────→ A3
B1 (latency telemetry) → B2 (k6 script) → B3 (deployed run)
epic-m0-live-verification S1 (deploy + Upstash) ──→ B3
epic-m0-live-verification D3/S3 (AC30) ──→ C1 (property-authorization delta only)
```

## Acceptance Criteria

**Gap A — bundle-size budget (relay plan step 1.9)**

1. A committed size-budget config exists in `packages/ga4-relay` covering
   the `./client` entrypoint with a documented gzip limit, and a
   `pnpm --filter @gtmss/ga4-relay size` (or equivalent) script runs it.
2. The check runs on every PR in GitHub Actions and **fails the build**
   when the client entrypoint exceeds budget — demonstrated by a
   deliberate temporary over-budget commit that goes red, then reverts.
3. The budget's unit and scope are written down unambiguously: bytes
   (5,120 vs 5,000), gzip vs brotli, and whether the number covers
   `index.js` alone or `index.js` plus its statically-reachable chunks.
4. The relay plan's documented escape hatch is preserved: exceeding the
   budget requires an explicit, reviewed budget bump in the config, not a
   silent pass.

**Gap B — load test (AC18)**

5. `telemetry.ts` emits a request-in → MP-request-issued duration for
   each forwarded request, recorded inside the `after()` callback, in a
   distinctly greppable structured-log shape (per telemetry.ts's existing
   "each counter independently greppable" doc contract).
6. A committed load-test script drives the collect handler at **50 RPS
   burst** with **a distinct per-virtual-user `kid`-keyed token**, so
   AC29's 120/min-per-`kid` default is not what fails the run. (The
   AC18-sanctioned alternative — an explicit test-only rate-limit
   override — is the fallback only if per-VU token minting proves
   impractical, and must be recorded as such.)
7. A run against a **deployed, non-local** target with the Upstash
   `Store` configured produces a p99, computed from the step-5
   server-side durations, and that p99 is **< 2s**. A local-only run does
   not satisfy AC18 and must not be reported as if it did.
8. The result (target URL/env, date, RPS achieved, p50/p95/p99, error
   rate, rate-limit strategy used) is written to a committed
   `docs/spikes/`-style note.

**Gap C — real-staging geo dimension (AC30), delta only**

9. Before `epic-m0-live-verification-plan.md` S3 executes, the user has
   explicitly confirmed *which GA4 property* AC30's synthetic geo-spoofed
   events may be written to — reuse of `catesworks.dev` / 551179302 is
   confirmed or replaced, not inherited by default. Recorded in that
   epic's D3 alongside the IP-source decision.

## Implementation Steps

Each numbered step is sized as one `bd` issue. Titles are imperative and
issue-ready.

### Gap A — CI-enforced client bundle-size budget

**A1. Fix build hygiene, then add a `size-limit` budget config for the
`./client` entrypoint.** First, add `clean: true` to the **client** and
**sw** tsup configs in `tsup.config.ts` (today only the server config cleans
its outDir), and rebuild once to purge the stale `chunk-7TUJHLLV.js` /
`queue-OYSWXHXL.js` orphans from `dist/client` before they ship to npm again.
Then add `size-limit` + `@size-limit/preset-small-lib` as devDependencies of
`packages/ga4-relay`, a `.size-limit.json` (or `"size-limit"` key in
`package.json`), and a `"size": "size-limit"` script. `size-limit` is the
right pick over `bundlesize` here: it is maintained, works on prebuilt files
without needing a webpack config, and understands ESM + gzip natively —
matching tsup's already-built `dist` output. **Pin `"path"` to the literal
`"dist/client/index.js"` — never a `*.js` glob** (a glob would measure the
stale orphans this step just removed, and would silently start red-lining CI
again if a future build regresses the `clean: true` fix). `index.js` inlines
everything (confirmed: zero `import` statements), so there is no separate
chunk to include in scope. Set `limit` to `"5 KB"` and write an inline
comment stating the measured baseline (3,749 B gzip, ~1.37 KB headroom — see
corrected Facts above) so a later bump is visibly a bump.
*Acceptance:* `pnpm --filter @gtmss/ga4-relay build && pnpm --filter
@gtmss/ga4-relay size` prints a gzip number for `dist/client/index.js` and
exits 0 at today's size; `ls dist/client` shows no `chunk-*`/`queue-*`
orphan files after a clean build; temporarily lowering `limit` to `"3 KB"`
makes it exit non-zero. Satisfies epic AC1 + AC3.
*Blocked on:* **work only.** Fully agent-doable, no user input needed.

**A2. Dropped (architect review).** `epic-ci-release-infra-plan.md` Step 1
is the confirmed sole owner of `.github/workflows/ci.yml` and is independent
of this epic (it doesn't need this epic's A1 to land first). A standalone
fallback issue here would be pure bd noise — **do not file A2**; A3 below
depends directly on that epic's Step 1 instead.

**A3. Wire the size budget into CI as a failing check.**
Add `pnpm --filter @gtmss/ga4-relay size` as a step in `ci.yml` after
`pnpm build`. Document in `packages/ga4-relay/README.md` (or a short
`CONTRIBUTING` note) that exceeding the budget requires an explicit
reviewed bump of the `limit` value with justification — the relay plan's
"documented escape hatch ... rather than silently exceeded" clause.
*Acceptance:* a throwaway PR that pads the client bundle past 5KB fails
CI on the size step specifically (not on tests); reverting it goes green.
Satisfies epic AC2 + AC4.
*Blocked on:* **work**, but gated on A1 **and** directly on
`epic-ci-release-infra-plan.md` Step 1 (`ci.yml` existing) — no A2
fallback. Not blocked on the user.

### Gap B — AC18 load test

**B1. Emit request-in → MP-forward-complete duration telemetry.**
`TelemetryEvent` currently has no latency variant and `recordTelemetry`
stamps only emit-time `ts`. **Architect-review correction to the measurement
point:** `create-collect-handler.ts` (lines ~213-214) emits `forwarded`
*after* `await sendToMp(...)` resolves — i.e. at MP round-trip **complete**,
not at the moment the MP request is merely *issued*. Emitting at true
"issued" time would only measure relay-internal work and be less
operationally useful; emitting at "complete" is what's actually
implementable from this code path. **Resolve this by measuring at
completion and naming the event so the log doesn't overclaim** (e.g.
`{ type: "mp-forward-latency"; durationMs: number; count: number }` measuring
request-in-to-MP-response-received, documented as such — not literally
AC18's "issued" wording). Capture a **distinct** request-in timestamp at the
top of the collect handler for this purpose — **do not reuse the existing
`requestReceivedAt`**, which only exists inside the `body.replay` branch for
timestamp bounding and is not populated on the main path. Also note
`runAfterResponse` loops over `batches`, so a single request can issue N
sends; decide (and document) whether B1 emits one latency event per batch or
one aggregate per request — per-batch is recommended since it matches the
existing per-event telemetry granularity. Keep the existing "independently
greppable counter" contract.
*Acceptance:* a unit/integration test asserts that a successful forward
emits one `mp-forward-latency` log line per batch with a numeric
`durationMs` measuring request-in-to-MP-response-received, emitted from the
`after()` path (the existing test harness already injects an immediate-await
`after()` substitute). Satisfies epic AC5.
*Blocked on:* **work only.** Prerequisite for B2/B3 — without it there is
nothing to compute a p99 from. This is the single highest-value unblocked
issue in Gap B and can start immediately.

**B2. Add a k6 load-test script with per-VU `kid`-keyed tokens.**
k6 over autocannon: autocannon fires a fixed request at fixed
concurrency, while AC18 needs **per-virtual-user distinct state** (one
token/`kid` per VU) plus a controlled arrival rate — k6's
`constant-arrival-rate` executor and per-VU `__VU`-keyed data model cover
both directly. Script lives at `packages/ga4-relay/load/collect-p99.js`
with a `"load:collect"` script; it is a **committed, manually-invoked
artifact, not a PR-gated CI job** — 50 RPS against a real deployment on
every PR is cost and flake, not signal. Optionally add a
`workflow_dispatch`-only job (in `ci.yml` once it exists, else
standalone) so it is runnable from the Actions UI with a target-URL
input. Token mechanics: each VU obtains its own `__ga4r_tok` cookie by
hitting a page served through `withGa4Token` middleware once at VU init
(one `mintToken` call per VU ⇒ one distinct `kid` per VU, since
`mintToken` generates a fresh `kid` per issuance), then reuses that
cookie for its own requests. 50 VUs at ~1 rps each keeps every VU far
under AC29's 120/min-per-`kid` default with no override needed. Record in
the script header that the test-only rate-limit override is the
documented fallback, not the primary approach.
*Acceptance:* `k6 run` against a locally running `apps/demo` completes at
the configured arrival rate with zero 429s in the k6 summary, and the
server logs show ≥50 distinct `kid` values across the run. Satisfies epic
AC6.
*Blocked on:* **work only** for the local dry run (k6 must be installed
locally — a dev-tool install, not a user decision). Depends on B1.

**B3. Run the load test against the deployed target and record the p99.**
Run B2's script against the deployed `apps/demo` with the Upstash `Store`
configured (AC17/AC18 both require a deployed function including the
Upstash round trip; the in-memory `Store` is explicitly not a
production-equivalence target). **Architect-review addition:** "collect from
Vercel logs" is not directly executable — Vercel runtime logs are
ephemeral/sampled by default with no drain configured for this project, so
there is no built-in way to retrieve ~thousands of `mp-forward-latency`
lines after the run. Add an explicit sub-step before running the load test:
either (a) provision a Vercel log drain (e.g. to a file/HTTP sink) for the
duration of the run, or (b) simpler and preferred — have B1's handler-side
code aggregate percentiles in-process (e.g. a lightweight reservoir/histogram
flushed as one summary log line at request-count or time intervals) so the
run produces one retrievable summary rather than depending on raw log
retention. Record which approach was used in the results note. Then compute
p50/p95/p99 and write the results note (target, date, RPS, percentiles,
error rate, rate-limit strategy, log-retrieval method used).
*Acceptance:* a committed results note shows p99 < 2s computed from
server-side `mp-forward-latency` values at a sustained 50 RPS burst
against a named deployed URL. Satisfies epic AC7 + AC8.
*Blocked on:* **user, via the M0 epic** — this consumes
`epic-m0-live-verification-plan.md` S1 (deploy `apps/demo`), which is
itself blocked on that epic's D1 (Vercel account/team/project/domain) and
D2 (Upstash provisioning). **One additional decision this epic must
surface, not covered there:** firing ~50 RPS of synthetic events will
write a large burst into whatever GA4 property the deployed demo points
at. Confirm that is acceptable, or point the load-test deployment at a
throwaway property / a `config.enabled: false` kill-switched variant for
the duration of the run. Do not assume the M0 epic's property choice
tolerates this volume.

### Gap C — AC30 real-staging geo dimension (delta only)

**C1. Confirm GA4 property authorization for AC30's synthetic geo events.**
Pure decision issue, no code, and the **only** Gap C item this epic
files — the AC30 retest itself is
`epic-m0-live-verification-plan.md` S3, gated on that epic's D3 (real
residential/mobile IP source, since the prior `8.8.8.8` attempt was
bot-filtered). The delta: that epic's S3 currently assumes events go to
property **551179302** (`catesworks.dev`) because M0.1's fidelity spike
used it. That is a *plausible* default, **not an authorization** — AC30
writes geo-spoofed synthetic events, a different pollution profile than
M0.1's handful of fidelity events, into a property whose data cannot be
deleted. Put to the user: (a) confirm 551179302 for this purpose,
(b) nominate a different existing property, or (c) create a dedicated
throwaway verification property. Also confirm the read-back method — GA4
Realtime UI screenshot (human clicks) vs. GA4 Data API (needs
service-account credentials that do not exist in this repo today; already
tracked as an open question in `.omc/plans/open-questions.md`).
*Acceptance:* the chosen property ID + read-back method are recorded in
`epic-m0-live-verification-plan.md`'s D3 block before S3 executes.
Satisfies epic AC9.
*Blocked on:* **user** — property authorization; credential provisioning
if the Data API read-back is chosen.

## Risks and Mitigations

- **Risk:** the 5KB budget is already nearly exhausted — 4,640 B gzip
  across all three `dist/client` files today, so <500 B of headroom if
  the budget counts chunks and 5KB means 5,120 B. Wiring the check could
  immediately red-line CI or, worse, be quietly set to a padded limit.
  **Mitigation:** A1 fixes scope and units *before* wiring CI (A3), and
  records the measured baseline in the config so any later bump is
  visibly a bump.
- **Risk:** `dist` is unminified (tsup has no `minify` configured), so
  the measured gzip number is conservative relative to what a minifying
  consumer bundler actually ships. **Mitigation:** treat the unminified
  measurement as the budget (it is what the package publishes) and note
  the conservatism explicitly rather than enabling minification solely to
  buy headroom.
- **Risk:** A3 depends on a `ci.yml` owned by a different epic; if that
  epic slips, the size check exists but enforces nothing, satisfying the
  letter of "a check exists" while missing step 1.9's actual
  "CI-enforced" requirement. **Mitigation:** A2 is retained as an
  explicitly-labelled fallback, and epic AC2 is written as "fails the
  build", not "a script exists".
- **Risk:** AC18's p99 depends on B1's new telemetry; running a load test
  first and reading client-side k6 timings would produce a number that
  *looks* like an answer but measures the wrong thing (the early `204`,
  not the `after()` MP forward). **Mitigation:** B1 is a hard
  prerequisite and epic AC7 names the source of the percentiles.
- **Risk:** the load test trips AC29's rate limiter and 429s get read as
  capacity limits. **Mitigation:** per-VU `kid` tokens (B2) keep each VU
  at ~1 rps against a 120/min default, and B2's acceptance explicitly
  asserts zero 429s plus ≥50 distinct `kid`s.
- **Risk:** B3's 50 RPS burst floods the GA4 property the deployed demo
  points at with synthetic events. **Mitigation:** called out as a named
  decision inside B3 (throwaway property or kill-switched deployment for
  the run), rather than inherited silently from the M0 epic's deploy.
- **Risk:** duplicate bd issues get filed for AC30 and for `ci.yml`
  because three epic plans were drafted in the same pass.
  **Mitigation:** the Scope boundary section above names the owning plan
  and step for each; A2 and C1 are explicitly written as
  fallback/delta issues.
- **Risk:** the AC30 retest is inconclusive again (bot filtering, geo
  settling latency). **Mitigation:** already handled in the M0 epic's S3
  ("an inconclusive result is not a negative result"); C1 adds only the
  property-authorization gate.

## Verification Steps

1. `pnpm --filter @gtmss/ga4-relay build && pnpm --filter @gtmss/ga4-relay size`
   — prints the client entrypoint gzip size and passes at the recorded
   baseline.
2. Throwaway PR padding the client bundle past budget — CI fails on the
   size step; revert restores green. (Gap A done.)
3. `pnpm test` — includes the new B1 telemetry assertion.
4. `k6 run packages/ga4-relay/load/collect-p99.js` against a local
   `apps/demo` — configured arrival rate reached, zero 429s, ≥50 distinct
   `kid` values in logs.
5. Deployed-target load run — p99 computed from server-side
   `mp-forward-latency` logs is < 2s at 50 RPS; results note committed.
   (Gap B done.)
6. `epic-m0-live-verification-plan.md` D3 records a user-confirmed
   property + read-back method for AC30. (Gap C delta done; AC30 itself
   closes under that epic's S3.)
7. `.omc/plans/ga4-server-side-relay-plan.md` cross-check — step 1.9's
   budget and AC18 are each now backed by a named, committed artifact.

## Open Questions (flag, don't guess)

- **[BLOCKING — Gap C] Is property 551179302 (`catesworks.dev`)
  authorized for AC30's synthetic geo-spoofed events**, or should a
  dedicated throwaway property be created? Prior use for M0.1's fidelity
  spike is not treated as standing authorization. (Delegate the answer
  into `epic-m0-live-verification-plan.md`'s D3.)
- **[BLOCKING — Gap B] Is a ~50 RPS synthetic burst acceptable against
  the GA4 property the deployed `apps/demo` points at?** If not, the
  load-test run needs a throwaway property or a kill-switched
  (`config.enabled: false`) deployment variant. Not covered by the M0
  epic's D1/D2.
- **[Recommendation, overridable] Load-test placement.** Plan assumes a
  committed script invoked manually (plus optionally a
  `workflow_dispatch` job), **not** a PR-gated CI job. Say so if you want
  it gating merges.
- **[Recommendation, overridable] Budget scope and units.** Plan assumes
  the `./client` entrypoint plus statically-reachable chunks, gzip, with
  `size-limit`'s own interpretation of `"5 KB"` written down explicitly
  in A1. If you want `index.js` alone, or brotli, or a hard 5,120-byte
  reading, say so before A1.
- **[Non-blocking] Should the `dist/sw` bundle get its own budget?**
  Relay plan step 1.9 caps only the client SDK; `dist/sw/index.js` is
  2,192 B gzip today and unbudgeted. Not in scope here — flagged so the
  omission is deliberate.

## Changelog

- Initial draft: covers the three confirmed M1 hardening gaps. Corrects
  the "AC9" label to "relay plan step 1.9" (AC9 in the relay plan is M2
  dedupe). Repo facts (current gzip sizes, absence of any build/test CI,
  absence of a latency telemetry event, `apps/demo` not deployed) were
  measured before drafting so they are not re-derived per issue.
- Revised after discovering three sibling epic plans written in the same
  pass: `ci.yml` is owned by `epic-ci-release-infra-plan.md` (A2 demoted
  to a fallback), and the AC30 retest plus the `apps/demo` deploy are
  owned by `epic-m0-live-verification-plan.md` (Gap C reduced to a single
  property-authorization delta; B3 now consumes that epic's deploy).
  Also corrected a factual error in the first draft, which proposed a
  "documented public IP" for AC30 — the prior attempt used `8.8.8.8` and
  was almost certainly GA4 bot-filtered, so a real residential/mobile IP
  is required (tracked as that epic's D3).
