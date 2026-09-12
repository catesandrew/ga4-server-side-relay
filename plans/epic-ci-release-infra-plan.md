# Epic: CI + Release Infra Gaps

Status: **pending approval**

Source: `docs/sessions/2026-08-24-ga4-relay-fixes-release/FOLLOWUPS.md`
("Blocked on work", "Nice-to-have / later", "Known risks / watch-outs").

## Requirements Summary

Three remaining gaps in this repo's CI and release infrastructure, carried over
from the `@gtmss/ga4-relay@0.1.1` release session. They are **independent of
each other** — none blocks another, and they can be picked up in any order:

1. **General CI workflow** — no `.github/workflows/ci.yml` exists. Nothing runs
   typecheck / lint / vitest / build on push or PR. *Blocked-on-work,
   agent-doable.*
2. **GitHub Release object for `@gtmss/ga4-relay@0.1.1`** — the git tag exists
   and is pushed, but no GitHub Release page was created.
   *Blocked-on-work, but a **public/user-visible action** — must be confirmed
   with the user before executing.*
3. **npm org decision for the `@gtmss` scope** — currently publishing under the
   personal `catesandrew` npm account with no npm Organization. *Not a task —
   a tracked **user decision** with no urgency.*

Independence check (confirmed, not assumed): item 2 does not depend on item 1
because `0.1.1` is already published to npm and tagged — a green CI run is not a
precondition for writing release notes for an already-shipped version. Item 3
changes nothing about how `0.1.1` was published and does not gate either other
item.

Facts gathered from the repo (do not re-derive):

- Root `package.json` scripts, verbatim:
  - `build`: `pnpm -r --filter=./packages/* build` — **packages only**;
    `apps/demo` is not built by this script.
  - `typecheck`: `tsc -p packages/ga4-relay/tsconfig.json --noEmit && tsc -p packages/ga4-relay/tsconfig.sw.json`
  - `lint`: `eslint .` (flat config at `eslint.config.js`)
  - `test`: `vitest run`
- `packageManager: "pnpm@10.33.2"` is set at root — `pnpm/action-setup@v4`
  reads this field, so the workflow must **not** hardcode a conflicting
  `version:` input.
- Existing workflow: `.github/workflows/skills-release.yml` only. Its
  conventions, to be matched: `actions/checkout@v4` → `pnpm/action-setup@v4` →
  `actions/setup-node@v4` (`node-version: 20`, `cache: pnpm`) →
  `pnpm install --frozen-lockfile`. The ordering comment at the top of that file
  explains why pnpm setup must precede `setup-node` with `cache: pnpm`.
- `skills-release.yml` already triggers on `push`/`pull_request` to `main`, with
  `concurrency.group: skills-release`. A new `ci` workflow needs its own
  distinct concurrency group so the two never cancel each other.
- Workspace: `packages/*` (`ga4-relay`, `skill-gtm-server-side-onboarding`) and
  `apps/*` (`demo`).
- `packages/ga4-relay/CHANGELOG.md` exists and already contains the full `0.1.1`
  patch-notes text (two Changesets entries, both `26c805e`) — this is the source
  for the GitHub Release body, not something to rewrite from scratch.
- Only one git tag exists: `@gtmss/ga4-relay@0.1.1`.
- Remote: `catesandrew/ga4-server-side-relay`. `gh` CLI is installed (2.98.0).
- Playwright (`test:e2e`) exists but Firefox/WebKit are separately blocked per
  FOLLOWUPS.md — e2e is explicitly **out of scope** for the CI workflow here.

## Acceptance Criteria

**Item 1 — `ci.yml`**

1. `.github/workflows/ci.yml` exists, named `ci`, triggering on
   `push: branches: [main]` and `pull_request: branches: [main]`.
2. It runs, as separate steps so a failure names itself in the GitHub UI:
   `pnpm run typecheck`, `pnpm run test`, `pnpm run lint`, `pnpm run build` —
   prefer the `pnpm run <script>` form over `pnpm exec vitest run`/
   `pnpm exec eslint .` so CI always follows `package.json`'s `test`/`lint`
   scripts (`package.json:7,9`) rather than bypassing them; same commands
   today, but CI won't silently drift if either script's definition changes.
3. Step order matches `skills-release.yml`: `actions/checkout@v4` →
   `pnpm/action-setup@v4` (no pinned `version:` input; inherits root
   `packageManager`) → `actions/setup-node@v4` with `node-version: 20` and
   `cache: pnpm` → `pnpm install --frozen-lockfile`.
4. `concurrency.group` is CI-specific and does **not** collide with
   `skills-release`, and does not let two rapid merges to `main` cancel each
   other's already-merged-commit check: use
   `ci-${{ github.workflow }}-${{ github.head_ref || github.run_id }}` (PR runs
   coalesce on `head_ref`; push-to-`main` runs never cancel each other since
   `run_id` is unique per run) with `cancel-in-progress: true`, not the naive
   `ci-${{ github.ref }}`.
5. `permissions` is minimal (`contents: read`) — this workflow publishes
   nothing.
6. No `NPM_TOKEN`, no `changesets/action`, no `playwright test` step.
7. The workflow's four commands pass locally from a clean
   `pnpm install --frozen-lockfile` before the workflow is committed.

**Item 2 — GitHub Release for `@gtmss/ga4-relay@0.1.1`**

8. User has explicitly approved creating the public Release before any
   `gh release create` runs.
9. A GitHub Release exists on `catesandrew/ga4-server-side-relay` targeting the
   existing tag `@gtmss/ga4-relay@0.1.1` — created against the **existing** tag,
   never re-tagging or moving it.
10. Release notes are derived from the `## 0.1.1` section of
    `packages/ga4-relay/CHANGELOG.md` (both patch entries preserved), not
    auto-generated boilerplate.
11. Not marked as a pre-release; not marked `--latest=false` unless the user
    says otherwise.

**Item 3 — npm org decision**

12. The decision is recorded (in `.omc/plans/open-questions.md` and this plan)
    with the tradeoff stated, and is **not** executed as part of this epic.

## Implementation Steps

Each numbered step below is sized to become one `bd` issue.

### Step 1 — Add `.github/workflows/ci.yml` *(bd: task, agent-doable)*

Create the workflow matching `skills-release.yml`'s conventions:

```yaml
name: ci

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # pnpm/action-setup MUST precede setup-node when using `cache: "pnpm"`
      # (the cache step shells out to `pnpm store path`). Version comes from
      # the root package.json `packageManager` field — do not pin it here.
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm run typecheck
      - run: pnpm run test
      - run: pnpm run lint
      - run: pnpm run build
```

Fix the `concurrency.group` line above to
`ci-${{ github.workflow }}-${{ github.head_ref || github.run_id }}` per AC4.

**Acceptance criteria (embedded for the bd issue):** criteria 1–7 above. Before
opening the PR, run all four commands locally from a clean
`pnpm install --frozen-lockfile` and confirm each exits 0; if any fails, fix the
underlying failure (or explicitly scope it out and say so in the PR body) rather
than dropping the step from the workflow. Confirm on the PR that both `ci` and
`skills-release / verify` run and neither cancels the other.

**Cross-epic note (architect review):** this file is the sole owner of
`.github/workflows/ci.yml`. Sibling epic `epic-m1-hardening-gaps-plan.md`'s
step A3 will, in a later follow-up PR, append a
`pnpm --filter @gtmss/ga4-relay size` step to this same workflow *after* the
`pnpm run build` step (its own step A2, which would have created a duplicate/
fallback `ci.yml`, is dropped — this Step 1 already satisfies it). Leave
`permissions: contents: read` as-is; it's sufficient unless a later size-limit
GitHub Action is configured to comment on PRs, which would need write access
to `pull-requests`.

### Step 2 — Create the GitHub Release for `@gtmss/ga4-relay@0.1.1` *(bd: task, **needs-user-confirmation-before-executing**)*

**Do not run this unattended.** `gh release create` publishes a page visible to
anyone on the public repo and can fire watcher notifications. Present the exact
command and the drafted notes to the user and get an explicit go-ahead first.

1. Confirm the tag is present on the remote:
   `git ls-remote --tags origin '@gtmss/ga4-relay@0.1.1'`; confirm `gh` is
   authenticated first via `gh auth status` (fail fast rather than mid-flow).
2. Draft release notes into a scratch file from the `## 0.1.1` section of
   `packages/ga4-relay/CHANGELOG.md` (keep both patch entries: the
   `session_id`/`ga_session_id` `NAME_DUPLICATED` fix and the SW-route 500 /
   `loadBundledSwScript` fix).
3. Show the user the drafted notes **and** the exact command; wait for approval:
   ```sh
   gh release create '@gtmss/ga4-relay@0.1.1' \
     --repo catesandrew/ga4-server-side-relay \
     --title '@gtmss/ga4-relay@0.1.1' \
     --notes-file <drafted-notes-file> \
     --verify-tag
   ```
   (`--repo`/`-R` pinned explicitly since the git remote is an SSH host-alias
   URL, not a plain `github.com` URL `gh` can always infer correctly.)
   (`--verify-tag` makes `gh` abort rather than create a new tag if the tag name
   is wrong — important because the tag contains `@` and `/`.)
4. On approval, run it; then verify with `gh release view '@gtmss/ga4-relay@0.1.1'`.

**Acceptance criteria (embedded for the bd issue):** criteria 8–11 above.

### Step 3 — Record the npm org decision *(bd: decision / non-actionable, low priority)*

Not work to execute. Record as a decision point:

> **Decision:** keep the `@gtmss` npm scope on the personal `catesandrew`
> account, or create an npm Organization for it?
>
> **Tradeoff:** staying on the personal account is zero-effort and works fine
> for a single maintainer — publishing, tokens, and the existing `0.1.1` release
> all keep working untouched. Creating an npm Organization is the only way to
> grant other humans publish rights, gives per-package team permissions and an
> org-level audit trail, and is materially easier to do *before* collaborators
> exist than to migrate to afterward (scope migration means moving package
> ownership and re-issuing publish tokens/CI secrets). Cost: an extra account to
> administer, and free npm orgs only cover public packages.
>
> **Trigger to revisit:** the first time a second person needs publish access to
> anything under `@gtmss`. Until then: no action, no urgency.

Also mirrored into `.omc/plans/open-questions.md`.

## Risks and Mitigations

- **Risk:** `pnpm run build` or `pnpm exec eslint .` currently fails on `main`
  and adding CI immediately red-flags the default branch.
  **Mitigation:** step 1 requires running all four commands locally from a clean
  `--frozen-lockfile` install *before* committing the workflow; a genuine
  failure gets fixed (or explicitly scoped out in the PR body), never silently
  dropped from the workflow.
- **Risk:** the new `ci` workflow and `skills-release` fight over concurrency or
  double-cancel, since both trigger on push+PR to `main`.
  **Mitigation:** distinct `concurrency.group` (`ci-${{ github.ref }}` vs.
  `skills-release`), verified on the first PR by confirming both workflows
  complete.
- **Risk:** hardcoding a pnpm `version:` in `pnpm/action-setup@v4` drifts from
  the root `packageManager: pnpm@10.33.2` and `--frozen-lockfile` starts failing
  on lockfile-format mismatch.
  **Mitigation:** omit the `version:` input entirely so the action reads
  `packageManager` — same as `skills-release.yml`.
- **Risk:** `pnpm run build` only covers `packages/*`, so CI would not catch a
  break in `apps/demo`.
  **Mitigation:** accepted and documented — FOLLOWUPS.md's first concrete step
  names exactly these four commands, and `apps/demo` needs `.env.local` values
  (per FOLLOWUPS.md's watch-outs) that don't exist in CI. Flagged as an open
  question rather than silently expanded.
- **Risk:** `gh release create` is run before the user approves, publishing a
  public page prematurely or (worse) creating a stray tag from a typo'd tag
  name.
  **Mitigation:** step 2 is explicitly gated on user confirmation and uses
  `--verify-tag`; the drafted notes are shown before anything is executed.
- **Risk:** release notes drift from the CHANGELOG if hand-written.
  **Mitigation:** notes are copied from the `## 0.1.1` CHANGELOG section, not
  re-composed.
- **Risk:** the npm org decision gets silently executed as "cleanup" by a future
  pass, breaking existing publish tokens.
  **Mitigation:** step 3 is recorded as a decision, not a task, with an explicit
  "no action until a second maintainer exists" trigger.

## Verification Steps

1. `pnpm install --frozen-lockfile && pnpm run typecheck && pnpm exec vitest run && pnpm exec eslint . && pnpm run build`
   — all four exit 0 locally before the workflow is committed.
2. Open the PR adding `ci.yml`; confirm via `gh pr checks` (or the Checks tab)
   that a `ci` check appears, runs all four steps as separately-named steps, and
   passes.
3. Confirm on that same PR that `skills-release / verify` still runs and is not
   cancelled by the new workflow's concurrency group.
4. After merge to `main`, confirm `ci` runs on the push event too
   (`gh run list --workflow=ci.yml`).
5. Item 2, after explicit user approval only:
   `gh release view '@gtmss/ga4-relay@0.1.1'` shows the release attached to the
   pre-existing tag, with notes matching the CHANGELOG's `## 0.1.1` section, and
   `git ls-remote --tags origin` shows no new/duplicate tag was created.
6. Item 3: confirm the decision text is present in
   `.omc/plans/open-questions.md` and that no npm org was created.

## Open Questions (flag, don't guess)

- Should CI also build `apps/demo` (i.e. `pnpm -r build` instead of the root
  `build` script's `--filter=./packages/*`)? Current plan: **no** — matches
  FOLLOWUPS.md's stated commands, and `apps/demo` needs `.env.local` values
  absent in CI. Say so if you want demo build coverage; it would need CI-safe
  placeholder env vars.
- Should CI run Playwright e2e (`pnpm run test:e2e`)? Current plan: **no** —
  Firefox/WebKit are a separately-tracked blocked item in FOLLOWUPS.md, and a
  chromium-only CI e2e job is a bigger decision (browser install caching, flake
  budget) than this epic covers.
- Should `ci.yml` use a Node version matrix (18/20/22) rather than the single
  `node-version: 20` that `skills-release.yml` uses? Current plan: **single 20**,
  matching existing repo convention.
- Item 2: is `@gtmss/ga4-relay@0.1.1` intended to be marked "Latest release" on
  the repo? Current plan assumes yes (gh's default for the newest tag).

## Changelog

- Initial draft: scopes the three CI/release-infra follow-ups from
  `docs/sessions/2026-08-24-ga4-relay-fixes-release/FOLLOWUPS.md` into bd-sized
  units — one agent-doable task, one user-confirmation-gated task, one recorded
  decision. Independence of the three confirmed, not assumed.
