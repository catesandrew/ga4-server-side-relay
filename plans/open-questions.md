# Open Questions

## Extract plan ADR into docs/decisions/ - 2026-09-05

- [ ] Add a `docs/decisions/README.md` index (numbering rules, status vocabulary) now, or wait for a second repo-wide ADR? — Plan assumes "wait"; inventing a convention doc ahead of a second data point is speculative.
- [ ] Promote/relocate the session-scoped ADR (`docs/sessions/2026-08-24-ga4-relay-fixes-release/adr/0001-separate-bundle-for-sw-script-loader.md`) into `docs/decisions/` so all ADRs live in one place? — Out of scope for this epic; flagged so the answer is deliberate rather than an oversight.

## Epic: CI + Release Infra Gaps - 2026-09-05

- [ ] Keep the `@gtmss` npm scope on the personal `catesandrew` account, or create an npm Organization? — Personal account is zero-effort and fine for a solo maintainer; an npm org is the only way to grant others publish rights and is far easier to set up *before* collaborators exist than to migrate to after (scope ownership transfer + re-issued publish tokens/CI secrets). No urgency; revisit the first time a second person needs publish access.
- [ ] Should `ci.yml` also build `apps/demo` (`pnpm -r build` vs. the root script's `--filter=./packages/*`)? — Plan assumes no: FOLLOWUPS.md names packages-only commands, and `apps/demo` needs `.env.local` values that don't exist in CI.
- [ ] Should `ci.yml` run Playwright e2e? — Plan assumes no: Firefox/WebKit are a separately-tracked blocked item, and a chromium-only CI e2e job (browser caching, flake budget) is a bigger decision than this epic.
- [ ] Node version matrix (18/20/22) in `ci.yml`, or single `node-version: 20`? — Plan assumes single 20 to match `skills-release.yml`.
- [ ] Should the `@gtmss/ga4-relay@0.1.1` GitHub Release be marked "Latest release"? — Plan assumes yes (gh's default); confirm at execution time since the Release is publicly visible.

## Epic: M0 Live Verification Spikes - 2026-09-05

- [ ] D1: Which Vercel account/team, project name, and domain for `apps/demo`? — No `.vercel` link exists and there is no default; blocks the deploy and therefore M0.3 + M0.4 entirely.
- [ ] D1a: Attach a real custom domain (e.g. a subdomain of `catesworks.dev`) or accept a bare `*.vercel.app` URL? — A `*.vercel.app` origin is a weaker analogue of a customer's first-party domain for the Safari ITP observation; deciding after 8 days of observation have elapsed is expensive.
- [ ] D2: Provision an Upstash Redis for the deployed demo's rate limiter, or explicitly disable rate limiting? — The relay throws at construction (AC23) with the in-memory Store under `NODE_ENV=production`, which `next build` always sets, so the Vercel build fails until this is decided. Upstash credentials cannot be self-served.
- [ ] D3: What real residential/mobile IP (and by what method — VPN, mobile hotspot, residential proxy) for the AC30 `ip_override` retest? — The prior `8.8.8.8` test was bot-filtered by GA4; "defer to genuine post-launch traffic" is a valid answer that closes the item honestly.
- [ ] Are GA4 Data API service-account credentials for property 551179302 available? — If yes, the Realtime "Tech" device/browser dimension check (M0.1b) is fully agent-doable; if no, it needs a human to click through the GA4 UI, which resisted direct URL navigation in the prior pass.
- [ ] How is the 48h+ steady-traffic requirement met — a scheduled synthetic sender (Vercel cron / GitHub Actions / local job, needs a host chosen) or organic traffic to the deployed demo? — A demo app may never produce genuinely "steady" organic traffic.
- [ ] Is testing whether synthesized `session_start`/`first_visit` closes more of the MP v2 fidelity gap (M0.1 item c) in scope for this epic, or its own follow-up issue? — Currently unassigned; flagged so it is not silently dropped.

## Epic: M1 Hardening Gaps - 2026-09-05

- [ ] **BLOCKING (AC30)** Is GA4 property 551179302 (`catesworks.dev`) authorized for AC30's *synthetic geo-spoofed* events, or should a dedicated throwaway property be created? — Prior use for M0.1's fidelity spike is not standing authorization for a different pollution profile, and GA4 property data cannot be deleted. Answer belongs in `epic-m0-live-verification-plan.md` D3 alongside the real-IP decision.
- [ ] **BLOCKING (AC18)** Is a ~50 RPS synthetic burst acceptable against whatever GA4 property the deployed `apps/demo` points at? — If not, the load-test run needs a throwaway property or a `config.enabled: false` kill-switched deployment variant. Not covered by the M0 epic's D1/D2.
- [ ] Should the AC18 load test be a manually-invoked committed script (plan's assumption, plus an optional `workflow_dispatch` job), or a PR-gated CI job? — 50 RPS against a real deployment on every PR is cost and flake, not signal; flagged so the cheaper default is a choice, not an oversight.
- [ ] What exactly does the 5KB client bundle budget measure — `dist/client/index.js` alone (3,749 B gzip today) or plus statically-reachable chunks (4,640 B); gzip or brotli; 5,120 B or 5,000 B? — Headroom is under 500 B on the conservative reading, so the interpretation materially decides whether the check passes on day one.
- [ ] Should `dist/sw/index.js` (2,192 B gzip, unbudgeted) get its own size budget? — Relay plan step 1.9 caps only the client SDK; flagged so the omission is deliberate rather than accidental.

## Cross-browser E2E Infra + Coverage Gaps - 2026-09-05

- [ ] Which dedupe-store route for e2e observability (CBE-6a): a demo-local single-process `Store` class, or a local Upstash-REST-compatible container wired to the real `UpstashStore`? — `apps/demo` currently cannot dedupe at all (placeholder Upstash creds make every `setNX` throw, so live events fail open), and `create-relay.ts` blocks `InMemoryStore` under `NODE_ENV=production`, which the e2e webServer is. Nothing in the multi-tab dedupe test can assert until this is picked.
- [ ] If the SW beacon-capture verdict comes back "promote to primary capture layer" (CBE-5), is the SW rearchitecture a separate follow-up epic? — Plan assumes yes (this epic stops at evidence + decision); promoting the SW is materially larger than an e2e epic should absorb.
- [ ] Is serving the e2e webServer over HTTPS (self-signed + `ignoreHTTPSErrors`) in scope as a follow-up, or is a documented WebKit skip list the accepted end state? — WebKit drops `Secure` cookies over `http://localhost` with no dev exception; `debug-endpoint.spec.ts` already skips for this, and enabling the webkit project will likely surface many more of the same class.
- [ ] Should the 3-browser Playwright run be part of the GitHub Actions workflow from day one, or a nightly/manual job? — Owned by `epic-ci-release-infra-plan.md`; the e2e webServer already does a full `next build` per invocation, so 3x projects has a real PR-latency cost.
