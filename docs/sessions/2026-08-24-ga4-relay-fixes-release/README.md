# Session: GA4 relay live-verification fixes + 0.1.1 release — 2026-08-24

> Resume pointer + index for this session's dossier. Read this first.

## State in one paragraph

`@gtmss/ga4-relay` (a self-hosted, first-party GA4 Measurement Protocol v2 relay for
Next.js/Vercel with an offline-capable service worker) shipped as a public GitHub repo
(`catesandrew/ga4-server-side-relay`) and public npm package earlier this session. This phase
live-verified it against a real GA4 property and real-browser Playwright e2e, found and fixed
two genuine bugs (a duplicate MP param, and a broken SW-serving route pattern that 500'd for
every real consumer), added Changesets tooling, and published the fixes as `0.1.1`. Everything
is committed, tagged, pushed, and published — **nothing is mid-flight or blocked** on this
specific work. Several pre-existing spike docs (Safari ITP, first-party mode, SW beacon-capture,
firefox/webkit e2e) remain genuinely open and need real infra this environment doesn't have.

## Resume prompt (paste into a new session)

```
Resume the ga4-relay-fixes-release work. Read
docs/sessions/2026-08-24-ga4-relay-fixes-release/README.md and FOLLOWUPS.md.
State: 0.1.1 published and pushed, tree clean, nothing blocked from this phase.
Next action: pick one open spike from docs/spikes/ (first-party-mode.md needs a real Vercel
deployment of apps/demo — cheapest one to unblock) or set up CI (no GitHub Actions workflow
exists yet).
```

## Repo state

| Repo | Branch | Last commit | Committed? | Pushed? | Notes |
|------|--------|-------------|-----------|---------|-------|
| `gtm-server-side` (github.com/catesandrew/ga4-server-side-relay) | main | `81e5643` "Version Packages" | yes | yes, plus tag `@gtmss/ga4-relay@0.1.1` | npm `@gtmss/ga4-relay@0.1.1` confirmed live on registry |

## Read first (rebuilds context fastest)

1. `SUMMARY.md` — what changed, per bug, with file paths
2. `docs/spikes/playwright-browser-e2e.md` — the fullest single account of the two real bugs found and fixed this session (in the repo itself, not just this dossier)
3. `docs/spikes/mp-fidelity.md` — the live GA4 debug-endpoint finding
4. `packages/ga4-relay/src/server/sw-script-loader.ts` — the fix's actual shape (why it's a separate tsup entry from `./server`)
5. `FOLLOWUPS.md` — what's still genuinely open (all pre-existing, none new)

## First action

Nothing is blocking. If continuing this line of work, the cheapest next unblock is deploying
`apps/demo` to a real Vercel project — that single deployment would let `docs/spikes/first-party-mode.md`
and (after ~8 days of observation) `docs/spikes/safari-itp-observation.md` both close out.

## Dossier contents

- `SUMMARY.md` — what was done
- `LESSONS.md` — lessons learned
- `adr/0001-separate-bundle-for-sw-script-loader.md` — the bundle-isolation decision
- `FOLLOWUPS.md` — open items (all pre-existing spikes; nothing new from this phase)
- `BLOG.md` — public write-up (⚠ review before publishing — uses a real personal domain, check before posting)
