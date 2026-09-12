# Epic: M0 Live Verification Spikes

Status: **pending approval**

## Requirements Summary

Close out the remaining M0 spike work in `.omc/plans/ga4-server-side-relay-plan.md`
that could not be completed in a single automated pass because it needs either
(a) a real deployed environment, (b) a human decision/credential, or (c) real
elapsed wall-clock time.

Three spikes are in scope. `docs/spikes/sw-beacon-capture.md` (M0.2) and
`docs/spikes/playwright-browser-e2e.md` are **not** in scope — they are already
resolved.

| Spike | File | Remaining |
| --- | --- | --- |
| M0.1 MP v2 fidelity | `docs/spikes/mp-fidelity.md` | 3 sub-items: (a) `ip_override`/AC30 retest from a real IP, (b) Realtime "Tech" report device/browser dimension check, (c) 48h+ Traffic-acquisition/Engagement settling |
| M0.3 first-party mode | `docs/spikes/first-party-mode.md` | Blocked entirely on a live `apps/demo` deploy |
| M0.4 Safari ITP longevity | `docs/spikes/safari-itp-observation.md` | Blocked on a live same-origin deploy, then 8+ days of elapsed observation |

Facts gathered from the repo (do not re-derive, do not re-ask):

- `apps/demo/` has **no** `.vercel/` directory — it has never been linked to or
  deployed to a real Vercel project. The only `.vercel/` in the repo is
  `website/.vercel` (the Docusaurus site, unrelated).
- `apps/demo` is a Next.js 15 / React 19 app depending on `@gtmss/ga4-relay`
  (`workspace:*`) and `@upstash/redis`. Routes:
  `app/api/ga4/collect/route.ts`, `app/api/ga4/debug/route.ts`,
  `app/ga4-relay/ga4-sw.js/route.ts`, plus `app/page.tsx` / `app/layout.tsx` /
  `app/ga4-init.tsx` / `app/consent-controls.tsx`.
- `apps/demo/.env.example` requires **seven** vars: `GA4_MEASUREMENT_ID`,
  `GA4_API_SECRET`, `GA4_TOKEN_SECRET`, `GA4_ALLOWED_ORIGINS`,
  `GA4_COOKIE_DOMAIN`, plus `UPSTASH_REDIS_REST_URL` and
  `UPSTASH_REDIS_REST_TOKEN`. It also documents that the relay **throws at
  construction time (AC23)** if `apiSecret`/`tokenSecret` are missing, or if
  rate limiting is enabled with the in-memory `Store` while
  `NODE_ENV=production` — and `next build` always sets `NODE_ENV=production`.
  **Architect-review correction:** there is no rate-limit-only off switch —
  `create-relay.ts` computes `rateLimitingEnabled = config.enabled !== false`,
  so the only way to avoid the in-memory-`Store`-under-production throw
  without Upstash is the whole-package kill switch (`config.enabled: false`),
  which also disables the collect handler's real response (`200
  {enabled:false}`, no cookies set) — breaking S4/S5's acceptance criteria,
  which need a genuinely working collect handler. **Provisioning Upstash Redis
  is therefore the only viable path for this epic's spikes**, not a two-option
  decision; see D2 below.
- A usable GA4 property already exists and is **not** blocked:
  `catesworks.dev`, property `551179302`, measurement ID `G-YC0JKCQVXY`. M0.1
  sub-item (b) can start immediately against it.
- Spike write-ups exist in **two** places and must be kept in sync:
  `docs/spikes/*.md` (internal engineering record) and
  `website/blog/2026-08-24-*.md` (published Docusaurus copies with front
  matter). Every spike-status change in this epic touches both.
- `.beads/` exists — these steps are sized to become individual `bd` issues.

## Acceptance Criteria

1. `apps/demo` is deployed to a real Vercel project on a stable URL, with all
   five `GA4_*` env vars set in the Vercel project and the build not tripping
   the AC23 in-memory-Store guard.
2. `docs/spikes/first-party-mode.md` no longer reads "blocked in this
   environment" — it records a live-tested finding for
   `gtag('config', ..., { server_container_url: ... })` against the deployed
   demo, and states whether M3.1 (script proxying) is viable via the supported
   mechanism.
3. `docs/spikes/safari-itp-observation.md` records a real 8+ day Safari
   observation of the `client_id` cookie against a genuinely same-origin
   deployed domain, with dated observation points, and the plan's ADR
   cookie-longevity claim is either upgraded from "mechanism-derived but not
   empirically validated" to validated, or the qualifier is retained with the
   observed counter-evidence.
4. `docs/spikes/mp-fidelity.md` records: (a) an `ip_override` result from a
   real residential/mobile IP that either populates a GA4 geo dimension
   (closing AC30) or fails for a documented reason other than bot filtering;
   (b) a Realtime "Tech" report observation stating whether device/browser/OS
   dimensions populate from a forwarded user-agent alone; (c) a
   Traffic-acquisition/Engagement report read after 48h+ of steady traffic.
5. Every `docs/spikes/*.md` change in this epic is mirrored into the
   corresponding `website/blog/2026-08-24-*.md` post (content only — front
   matter preserved), and `cd website && pnpm build` still passes with
   `onBrokenLinks: 'throw'`.
6. No spike is marked resolved on the strength of an assumption, a mock, or
   `/debug/mp/collect` alone — AC30 in particular explicitly requires a real
   GA4 property, not a mock server.

## Decision Points (blocking — human only, resolve before the steps they gate)

These are **not** implementation steps. Each is a decision only the user can
make; no default is assumed here.

- **D1 — Vercel target for `apps/demo`.** Which Vercel account/team, which
  project name, and which domain? There is no existing `.vercel` link for
  `apps/demo` and no default. **Critically**, M0.4 requires a *genuinely
  same-origin* domain — the decision is specifically whether a real custom
  domain (e.g. a subdomain of `catesworks.dev`, matching the existing GA4
  property) is attached, or whether a bare `*.vercel.app` URL is accepted. A
  `*.vercel.app` URL is same-origin in the browser sense and is likely
  adequate for M0.3, but is a weaker analogue of a customer's real first-party
  domain for M0.4 — the user must decide whether that weakening is acceptable
  or whether a custom domain is provisioned first. *Gates: S1, and via S1 all
  of S4/S5/S6.*
- **D2 — Upstash Redis for the deployed demo.** The relay throws at
  construction when rate limiting is enabled with the in-memory Store under
  `NODE_ENV=production`, and the only alternative — the `config.enabled: false`
  whole-package kill switch — also disables the collect handler's real
  response entirely, which breaks S4/S5's acceptance criteria. **There is no
  rate-limit-only off switch in the current code**, so this is not a
  two-option decision: the user must provision an Upstash Redis instance and
  supply its REST URL/token as Vercel env vars. This secret cannot be
  self-served by an agent. (Adding a genuine rate-limit-only disable knob to
  the package is out of scope for this epic — it would be a separate,
  blocked-on-work feature request, not a deploy prerequisite.) *Gates: S1.*
- **D3 — Real-IP method for the AC30 `ip_override` retest.** The prior test
  used `8.8.8.8` and was almost certainly bot-filtered by GA4. The user must
  choose the substitute: a VPN exit node, a mobile hotspot / tethered cellular
  IP, a residential proxy, or "accept that this can only be confirmed from
  genuine end-user traffic post-launch" (an explicit deferral is a valid
  answer and closes the item as WONTFIX-for-now rather than leaving it open).
  Note the IP does not have to be the machine's own — `ip_override` is a
  payload field — but it must be an IP GA4 will not classify as datacenter
  traffic. *Gates: S3.*

## Implementation Steps

Sized for individual `bd` issues. Each has a title, acceptance criteria, and a
blocked-on classification.

### S1 — Deploy `apps/demo` to a real Vercel project

**Blocked on:** user (D1, D2). Once both decisions land, the mechanical work is
agent-doable except for the `vercel link` / dashboard auth step, which needs the
user's Vercel session.

**Acceptance criteria:**
- `apps/demo/.vercel/project.json` exists, created by Vercel's own CLI or
  dashboard link — never hand-written.
- The Vercel project's root directory is set to `apps/demo`, with a build
  command that resolves the `workspace:*` dependency on `@gtmss/ga4-relay`
  from the pnpm monorepo root (i.e. the monorepo build, not an isolated
  `apps/demo` install).
- All five env vars from `apps/demo/.env.example` are set in the Vercel
  project with real values: `GA4_MEASUREMENT_ID` (`G-YC0JKCQVXY` unless D1
  selects a different property), `GA4_API_SECRET`, `GA4_TOKEN_SECRET`,
  `GA4_ALLOWED_ORIGINS` (the deployed origin, not `localhost:34577`),
  `GA4_COOKIE_DOMAIN` (the deployed host, not `localhost`).
- D2's outcome is reflected in the deployment config (Upstash credentials
  present, or rate limiting explicitly off) and the production build completes
  without tripping the AC23 construction-time throw.
- `.vercel` is gitignored for `apps/demo` — already satisfied: root
  `.gitignore`'s bare `.vercel` entry (added during the website work) matches
  at every directory depth, including `apps/demo/.vercel`; no new entry
  needed (verify with `git check-ignore -v apps/demo/.vercel/project.json`).
- Smoke test against the live URL: `GET /` returns 200 and renders the demo
  page; `POST /api/ga4/collect` with a valid payload **and an `Origin` header
  matching the deployed origin** (the collect handler 403s on any Origin not
  in `GA4_ALLOWED_ORIGINS`, and the token's origin-binding re-checks it)
  returns **`200`** with its identity JSON body (not `204` — that status
  belongs to GA4's own MP endpoint, not this relay); the response sets the
  `__ga4r_cid` cookie (not `client_id` — that is the cookie's *semantic*
  content, but its actual name in `cookies.ts` is `__ga4r_cid`) on the
  deployed domain.

**Ordering:** S1 blocks S4, S5, S6, and is also the upstream deploy that
`epic-m1-hardening-gaps-plan.md`'s B3 (deployed load-test run) consumes — do
not stand up a second deployment for that epic. It does *not* block S2 or S3.

### S2 — Confirm device/browser dimensions in the GA4 Realtime "Tech" report (M0.1b)

**Blocked on:** work — **not** blocked on the deploy. The `catesworks.dev`
property (551179302) is already live and usable.

**Human-vs-agent note:** the GA4 *UI* Realtime "Tech" report is not reliably
reachable by direct URL navigation (this is exactly why the prior pass gave up
on it), so the UI click-through is effectively **human-only**. However, the
same question is answerable programmatically: the **GA4 Data API**'s realtime
report supports `deviceCategory` / `browser` / `operatingSystem` dimensions,
which is agent-doable if service-account credentials for property 551179302
are available. Treat the API route as the primary attempt and the human
click-through as the fallback. If neither credential nor human time is
available, this becomes blocked-on-user for GA4 Data API access.

**Acceptance criteria:**
- A batch of events is sent to property 551179302 through the relay's own
  `buildMpPayload`/`collectUrl` path with a forwarded, realistic
  `user-agent` header (and a second control batch *without* it).
- The Realtime device/browser/OS dimensions are read (Data API realtime report
  or the UI Tech report) and the result recorded: which dimensions populate
  with the forwarded UA, and which are `(not set)` without it.
- `docs/spikes/mp-fidelity.md` bullet 4 ("Device/browser dimension fidelity …
  Still open") is replaced with the concrete finding, including the method
  used (API vs UI) so the result is reproducible.
- If MP v2 does **not** populate these dimensions even with a forwarded UA,
  that is recorded as a documented v1 fidelity limitation, not a blocker.

### S3 — Retest `ip_override` / AC30 from a real residential or mobile IP

**Blocked on:** user (D3) for the IP source. Once the IP/method is chosen, the
send-and-verify work is agent-doable.

**Blocked on:** user (D3) for the IP source, **and on
`epic-m1-hardening-gaps-plan.md`'s C1** (GA4 property authorization for AC30's
synthetic geo-spoofed events — reuse of `catesworks.dev`/551179302 is a
plausible default, not a standing authorization; C1 must resolve before this
step sends anything). Once both land, the send-and-verify work is agent-doable.

**Acceptance criteria:**
- At least two events are sent to the C1-authorized property with
  `ip_override` set to the D3-chosen real residential/mobile IP, using the
  same relay code path as the prior test, each returning **`200`** with its
  identity JSON body (not `204` — see S1's status-code correction).
- The GA4 geo dimension (country and, where available, region) is checked for
  those events — not just Realtime event visibility, but the **geo dimension
  value itself**, since AC30 is about confirmed *effect*, not sourcing (AC5)
  and not schema validity (`/debug/mp/collect` catches neither).
- Result recorded in `docs/spikes/mp-fidelity.md`, replacing the "inconclusive,
  not a negative result" bullet: either AC30 is confirmed closed, or the
  failure is characterized with a cause other than bot filtering.
- If D3 resolves to "defer to post-launch real traffic", this issue is closed
  as deferred with that rationale written into the spike doc and the AC30 row
  of the main plan annotated accordingly — an explicit deferral, not silence.

### S4 — Verify Google-native first-party mode against the live demo (M0.3)

**Blocked on:** work, once S1 lands. No further user decision needed beyond D1.

**Acceptance criteria:**
- A `gtag`-instrumented page on the deployed demo is configured with
  `gtag('config', 'G-YC0JKCQVXY', { server_container_url: '<deployed relay
  origin>' })` and loaded in a real browser.
- Network traffic is captured showing where `gtag.js` actually sends its
  collect requests under that config: the relay origin, `google-analytics.com`,
  or both.
- The finding explicitly answers M3.1's scoping question: is first-party
  script/transport routing achievable via the **supported**
  `server_container_url`/`transport_url` mechanism on a Vercel deployment, or
  would it require unsupported plumbing (response-body rewriting of Google's
  bundle — which the main plan forbids outright)?
- `docs/spikes/first-party-mode.md` status line changes from "blocked in this
  environment" to a live-verified finding, and the main plan's 3.1 entry
  ("contingent on M0.3 findings") is annotated with the outcome.
- The existing "default assumption" (M3.1 stays out of v1 scope) is either
  confirmed or explicitly revised — not left dangling.

### S5 — Start the Safari ITP cookie-longevity observation clock (M0.4, day 0)

**Blocked on:** work, once S1 lands — but **requires a human with a real Safari
browser** to establish the baseline (a persistent, non-automated Safari profile
that will not be wiped between checks; a headless/WebKit-automation profile
does not exercise ITP the way a real user profile does).

**Acceptance criteria:**
- A real Safari session visits the deployed demo, triggers a relay collect, and
  the **`__ga4r_cid`** cookie (not `client_id` — see S1's naming correction) is
  confirmed set by a server-side `Set-Cookie` on a genuinely same-origin
  response (not `document.cookie`, not a CNAME hop) — verified in Safari's
  Storage inspector, with the cookie's expiry recorded (expected
  `Max-Age=63072000` from `cookies.ts`).
- Day 0 is recorded in `docs/spikes/safari-itp-observation.md` with: the exact
  date/time, the deployed origin used, the Safari version, the recorded
  `__ga4r_cid` value, and the observed expiry.
- An explicit check schedule is written into the doc (at minimum: day 3, day 7,
  day 8, day 10 — day 7→8 is the critical boundary, since that is where ITP's
  7-day cap would bite if it applied).
- **This step does not resolve M0.4.** It only starts the clock. Closing the
  spike is S6.

### S6 — Close out the Safari ITP observation after 8+ elapsed days (M0.4, day 8+)

**Blocked on:** *elapsed real-world time* — this is a waiting period, not an
effort estimate. It cannot start until 8 calendar days after S5, and it cannot
be compressed. Treat it as a scheduled follow-up issue with a target date, not
a backlog item to burn down.

**Acceptance criteria:**
- The `__ga4r_cid` cookie's presence and value are checked in the *same*
  Safari profile at each scheduled point, with each check dated in the spike
  doc.
- At day 8+, the doc states unambiguously whether the cookie survived past the
  7-day boundary with its original value intact.
- The main plan's ADR qualifier ("mechanism-derived but not yet empirically
  validated") is updated: removed if the cookie survived, or replaced with the
  observed behavior and its implications if it did not.
- The main plan's risk-table row ("Safari ITP caps CNAME-cloaked cookies at 7
  days") is annotated with the empirical result.
- If the profile is wiped, Safari is updated mid-window, or the observation is
  otherwise invalidated, the run is declared void and S5 is re-run — a partial
  observation is not reported as a result.

### S7 — Let Traffic-acquisition / Engagement reports settle over 48h+ of steady traffic (M0.1c)

**Blocked on:** *elapsed real-world time*, same pattern as S6, plus a
prerequisite: steady traffic must actually be flowing. Sending one burst and
waiting 48h does not satisfy "steady traffic".

**Property isolation (architect review):** this step's "steady, low-rate"
traffic and `epic-m1-hardening-gaps-plan.md`'s B3 (50 RPS load-test burst) must
not run concurrently against the same GA4 property — a burst during this
window invalidates S7's "steady traffic" read, and pollutes S2/S3 too.
Coordinate scheduling explicitly, or point B3 at a separate/throwaway property
per that epic's own B3 note.

**Acceptance criteria:**
- A steady, low-rate synthetic traffic source runs against property 551179302
  (via the relay path) for at least 48 continuous hours — the mechanism (cron,
  scheduled job, or the live demo receiving real visits post-S1) is recorded in
  the spike doc.
- After 48h+, the GA4 Traffic-acquisition and Engagement reports are read and
  compared against what a `gtag`-instrumented control would show, per M0.1's
  original framing.
- `docs/spikes/mp-fidelity.md` "Still blocked / out of scope for a single pass"
  paragraph is replaced with the settled-report finding.
- The still-untested sub-question — whether synthesizing
  `session_start`/`first_visit` from the relay's session cookie would close
  more of the fidelity gap (M0.1 item (c)) — is either tested in this window or
  explicitly carried forward as its own follow-up issue. It is **not** silently
  dropped.

### S8 — Sync spike docs, website blog mirrors, and the main plan

**Blocked on:** work. Runs after each of S2/S3/S4/S6/S7 lands (either once at
the end, or incrementally — incremental is preferred so the published site does
not lag reality).

**Acceptance criteria:**
- Each updated `docs/spikes/*.md` has its content mirrored into the matching
  `website/blog/2026-08-24-*.md` post, preserving that post's existing front
  matter (`slug`, `title`, `authors`, `tags`, `date`).
- `.omc/plans/ga4-server-side-relay-plan.md` M0 section and the affected AC/risk
  rows (AC30, the ITP risk row, 3.1's M0.3 contingency) are annotated with
  outcomes — the plan stops claiming these are open once they are closed.
- `cd website && pnpm build` passes with `onBrokenLinks: 'throw'`.
- No spike doc is left with a stale "blocked in this environment" status line
  for work that has since been completed.

## Ordering / Dependency Graph

```
D1 (Vercel target) ──┐
D2 (rate-limit store)─┴─→ S1 (deploy) ─┬─→ S4 (first-party mode)
                                       └─→ S5 (ITP day 0) ─→ [8+ days] ─→ S6 (ITP close)

D3 (real IP) ──┐
epic-m1-hardening-gaps C1 (property auth) ─┴─→ S3 (ip_override / AC30)

(no blocker) ──→ S2 (Realtime Tech report)

S1 (or independent traffic source) ─→ S7 (48h+ settle) ─→ [48h] ─→ S7 close

S2, S3, S4, S6, S7 ─→ S8 (doc sync)
```

Start-now candidates (nothing blocking): **S2**. Start-after-one-decision:
**S3** (needs D3 only). Everything else waits on the deploy.

## Risks and Mitigations

- **Risk**: the Vercel build for `apps/demo` fails on the `workspace:*`
  dependency because the project root is set to `apps/demo` instead of the
  monorepo root. **Mitigation**: S1's acceptance criteria call this out
  explicitly; Vercel's monorepo settings (root directory + install command run
  from repo root) must be configured, not defaulted.
- **Risk**: the deploy trips the AC23 in-memory-Store guard at build time and
  the failure is misread as an unrelated build error. **Mitigation**: D2 forces
  the store decision *before* S1 starts, and S1's criteria name the guard.
- **Risk**: a `*.vercel.app` URL is used for M0.4 and the result is later
  argued to not represent a customer's real first-party domain. **Mitigation**:
  D1 makes this an explicit user decision with the tradeoff stated, rather than
  discovering it after 8 days of observation have elapsed.
- **Risk**: the Safari observation is invalidated mid-window (profile cleared,
  Safari updated, different machine used) and a partial result is reported as
  conclusive. **Mitigation**: S6 has an explicit void-and-restart criterion.
- **Risk**: S6 and S7 are treated as ordinary backlog items and get "completed"
  in one sitting by writing plausible-looking results. **Mitigation**: both are
  labeled elapsed-time-blocked here and their criteria require *dated*
  observation points, not a single write-up.
- **Risk**: the AC30 retest is inconclusive again for a different reason (e.g.
  the chosen VPN exit is also classified as datacenter traffic). **Mitigation**:
  S3's criteria require characterizing the failure cause, and D3 includes an
  explicit "defer to post-launch traffic" option so this can be closed honestly
  rather than retried indefinitely.
- **Risk**: `docs/spikes/*.md` and `website/blog/*.md` drift, so the published
  site advertises stale "blocked" statuses. **Mitigation**: S8 exists as its own
  step with a build gate, and is preferred to run incrementally.

## Verification Steps

1. `test -f apps/demo/.vercel/project.json` — the demo is linked (S1).
2. `curl -s -o /dev/null -w '%{http_code}' https://<deployed-demo>/` → `200`;
   a `POST` to `/api/ga4/collect` with a valid payload and a matching `Origin`
   header → `200` and a `Set-Cookie: __ga4r_cid=…` on the response (S1).
3. `grep -L 'blocked in this environment' docs/spikes/first-party-mode.md
   docs/spikes/safari-itp-observation.md` — both files listed, i.e. neither
   still carries the blocked status (S4, S6).
4. `grep -c '2026-' docs/spikes/safari-itp-observation.md` — at least 4 dated
   observation points present, spanning 8+ days (S5/S6).
5. `grep -i 'still open\|inconclusive' docs/spikes/mp-fidelity.md` returns
   nothing, or only text explicitly marked as a documented v1 limitation /
   deferred item with rationale (S2, S3, S7).
6. `cd website && pnpm build` — passes with `onBrokenLinks: 'throw'` after the
   blog mirrors are updated (S8).
7. `git diff .omc/plans/ga4-server-side-relay-plan.md` — shows the M0 section,
   AC30, the ITP risk row, and 3.1's M0.3 contingency annotated with outcomes
   (S8).

## Open Questions (flag, don't guess)

- **D1 — which Vercel account/team, project name, and domain for `apps/demo`?**
  No `.vercel` link exists and there is no default. Sub-question that materially
  affects M0.4's strength as evidence: is a real custom domain (e.g. a
  subdomain of `catesworks.dev`) attached, or is a bare `*.vercel.app` URL
  acceptable for the same-origin cookie observation?
- **D2 — Upstash Redis instance for the deployed demo's rate limiter, or
  disable rate limiting on the demo?** If Upstash, the credentials must come
  from the user; they cannot be self-served.
- **D3 — what real residential/mobile IP (and by what method) for the AC30
  `ip_override` retest?** VPN exit, mobile hotspot, residential proxy, or an
  explicit decision to defer AC30 to genuine post-launch traffic.
- **S2 access** — are GA4 Data API service-account credentials for property
  551179302 available? If yes, S2 is fully agent-doable via the realtime
  report. If no, S2 needs a human to click through the GA4 UI's Realtime "Tech"
  report, since that view resisted direct URL navigation in the prior pass.
- **S7 traffic source** — should the 48h steady-traffic requirement be met by a
  scheduled synthetic sender (needs somewhere to run: a Vercel cron, a GitHub
  Actions schedule, or a local job), or by waiting for organic traffic to the
  deployed demo? The former is faster but needs a host chosen; the latter may
  never produce "steady" traffic on a demo app.
- **M0.1 item (c)** — is testing whether synthesized `session_start`/
  `first_visit` closes more of the fidelity gap in scope for this epic, or does
  it become its own follow-up issue? S7 currently allows either but requires an
  explicit choice.

## Changelog

- Initial draft: scoped to the three unresolved M0 spikes (M0.1 remaining
  sub-items, M0.3, M0.4); M0.2 and the Playwright e2e spike excluded as already
  resolved. Three user decision points (D1/D2/D3) separated out from the eight
  implementation steps; S6 and S7 flagged as elapsed-time-blocked rather than
  effort-blocked.
