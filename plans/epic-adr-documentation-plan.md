# Epic: Extract plan ADR into `docs/decisions/`

Status: **pending approval** — small, low-priority, blocked-on-work only (no user decision needed)

## Requirements Summary

`.omc/plans/ga4-server-side-relay-plan.md` carries an `## ADR` section (the
"Option A" architecture decision: build a single-tenant, same-origin,
first-party GA4 collection relay rather than an sGTM clone, a multi-tenant
SaaS, or a reverse-proxied self-hosted sGTM image). Its central claimed
advantage — cookie longevity under Safari ITP, because a genuinely same-origin
`Set-Cookie` is not subject to ITP's 7-day `document.cookie` cap — is currently
recorded only inside a 72KB plan file. Plans are working documents; the
decision is durable. It should live as a standalone, repo-wide ADR.

This repo has exactly one ADR precedent today:
`docs/sessions/2026-08-24-ga4-relay-fixes-release/adr/0001-separate-bundle-for-sw-script-loader.md`
— a *session*-scoped ADR. `docs/decisions/` (the repo-wide equivalent) does not
exist yet and must be created by this epic.

Facts gathered from the repo (not to be re-asked):
- Source ADR content: `.omc/plans/ga4-server-side-relay-plan.md` lines ~212-224
  (`## ADR` → Decision / Drivers / Alternatives considered / Why chosen /
  Consequences / Follow-ups).
- Format convention to follow (from the session ADR): H1 `# ADR NNNN: <title>`,
  then a `Status` / `Date` / `Deciders` bullet block, then `## Context`,
  `## Options considered` (numbered, each with Pros/Cons), `## Decision`,
  `## Consequences` (Positive / Negative-cost / Follow-on), `## Notes`
  (code refs, related docs, commit).
- The ITP caveat that must be carried over verbatim in substance: the
  cookie-longevity advantage is **mechanism-derived but not yet empirically
  validated**, pending the M0.4 8+ day real-Safari observation tracked in
  `docs/spikes/safari-itp-observation.md`. Plan lines 104 and 171 state this.
- `docs/decisions/` does not exist; no other repo-wide ADRs exist to renumber
  around, so `0001` is free.

## Acceptance Criteria

1. `docs/decisions/0001-same-origin-first-party-relay-for-cookie-longevity.md`
   exists.
2. It follows the section structure of the existing session ADR at
   `docs/sessions/2026-08-24-ga4-relay-fixes-release/adr/0001-separate-bundle-for-sw-script-loader.md`
   — H1 with ADR number, Status/Date/Deciders block, `## Context`,
   `## Options considered`, `## Decision`, `## Consequences`, `## Notes`.
3. `## Options considered` covers Option A (the decision — single-tenant,
   same-origin, first-party relay) plus Options B, C, and D as rejected
   alternatives, each with its invalidation rationale (B: sandboxed
   template-engine cost, not statelessness; C: auth/billing/secret-custody
   before core value is proven; D: requires an always-on host, conflicting
   with the Vercel-only constraint).
4. The ADR states the Safari ITP / same-origin cookie mechanism explicitly, and
   labels the cookie-longevity advantage with the literal phrase
   **"mechanism-derived but not yet empirically validated"** (verify with
   `grep -F "mechanism-derived but not yet empirically validated" docs/decisions/0001-*.md`),
   with a link to `docs/spikes/safari-itp-observation.md` as the pending
   validation.
5. `## Consequences` carries over the plan's substantive consequences: lower
   data fidelity than real sGTM, no multi-destination fan-out in v1/v2,
   best-effort delivery in v1, rate limiting only real with the Upstash `Store`
   configured, and same-origin same-app deployment as a hard requirement. A
   `Consequences → Follow-on` subsection (matching the precedent at
   `adr/0001-separate-bundle-for-sw-script-loader.md:63`) carries over the
   plan's own `**Follow-ups**` note (plan line ~224): M0 spike outcomes may
   reshape this decision, and it should be re-reviewed after
   `docs/spikes/safari-itp-observation.md` closes.
6. `Status:` is `proposed` (not `accepted`) — the underlying plan itself is
   still "pending approval" per its own header, and the decision is listed as
   an assumption requiring user confirmation (plan lines ~226-234), so the ADR
   must not overclaim settledness. Include a `Date:` and `Deciders:` line
   consistent with the session-ADR precedent, plus a one-line note that status
   should be revisited to `accepted` once the underlying plan is confirmed.
7. No source content is deleted: `.omc/plans/ga4-server-side-relay-plan.md`
   keeps its `## ADR` section unchanged (`git diff` shows no change to that
   file).
8. No code files are touched — the diff is exactly one new Markdown file (plus
   the new `docs/decisions/` directory).

## Implementation Steps

1. **Create `docs/decisions/0001-same-origin-first-party-relay-for-cookie-longevity.md`.**
   (Single bd issue. Small / low priority.)
   - Read the format precedent first:
     `docs/sessions/2026-08-24-ga4-relay-fixes-release/adr/0001-separate-bundle-for-sw-script-loader.md`.
   - Read the source content: the `## ADR` section of
     `.omc/plans/ga4-server-side-relay-plan.md`, plus its Option A/B/C/D
     rationale block near the top of the file and the two ITP caveat lines
     (M0.4 background clock; the risk-table row on CNAME-cloaked cookies).
   - Write the new ADR in the precedent's structure, rewriting plan prose into
     standalone ADR voice (the ADR must be readable without the plan open —
     no bare references to "M1 1.12" or "AC17/AC18" without a one-clause gloss).
   - `## Notes` should point back to `.omc/plans/ga4-server-side-relay-plan.md`
     as the origin, and to `docs/spikes/safari-itp-observation.md` as the
     pending empirical validation.
   - **Acceptance criteria for this step:** all 8 criteria above hold; a reader
     who has never opened the plan can state from the ADR alone what was
     decided, what was rejected and why, and what is still unvalidated.

## Risks and Mitigations

- **Risk**: the extracted ADR drifts from the plan's `## ADR` section over time,
  leaving two sources of truth. **Mitigation**: the ADR's `## Notes` names the
  plan as its origin; the plan is a working document that goes stale by design
  while the ADR is the durable record — if they conflict later, the ADR wins.
- **Risk**: the "mechanism-derived, not empirically validated" caveat gets
  dropped or softened during rewriting, making the ADR overclaim on ITP
  behavior. **Mitigation**: acceptance criterion 4 makes it explicit and
  verifiable.
- **Risk**: numbering collides with a future repo-wide ADR, or with the
  session-scoped `0001`. **Mitigation**: `docs/decisions/` is a separate
  namespace from `docs/sessions/*/adr/`; both may hold an `0001` without
  ambiguity since the path disambiguates.

## Verification Steps

1. `ls docs/decisions/` — shows exactly the one new
   `0001-same-origin-first-party-relay-for-cookie-longevity.md`.
2. Read the new file top to bottom — confirm every acceptance criterion (1-6)
   against it directly.
3. `git status --short -- docs/decisions/` — shows exactly one new untracked
   Markdown file (scoped to `docs/decisions/` deliberately: an untracked file
   never appears in `git diff`, and unscoped `git status --short` would also
   show pre-existing untracked noise like `.beads/PRIME.md`/`.cbmignore`).
   Separately confirm no modification to
   `.omc/plans/ga4-server-side-relay-plan.md` or any file under `packages/`,
   `apps/`, or `website/` via `git status --short`.

## Open Questions (flag, don't guess)

- Should the repo also get a `docs/decisions/README.md` index (numbering rules,
  status vocabulary) now, or wait until there is a second repo-wide ADR? This
  plan assumes **wait** — one file does not need an index, and inventing a
  convention document ahead of a second data point is speculative.
- Should the existing session-scoped ADR
  (`0001-separate-bundle-for-sw-script-loader.md`) be promoted/relocated into
  `docs/decisions/` too, so all ADRs live in one place? Out of scope for this
  epic; flagged only so the answer is a deliberate choice rather than an
  oversight.
