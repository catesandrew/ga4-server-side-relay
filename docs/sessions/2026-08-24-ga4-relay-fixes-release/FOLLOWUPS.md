# Follow-ups — GA4 relay live-verification fixes + 0.1.1 release (2026-08-24)

Live list of what's left. All items below are **pre-existing** environment-blocked spikes
(`docs/spikes/*.md`) — nothing new was left incomplete by this session's own work.

## Blocked on the user (decisions / approvals / access)

- [ ] Deploy `apps/demo` to a real Vercel project — needed to close both
  `docs/spikes/first-party-mode.md` (Google's native first-party mode check) and
  `docs/spikes/safari-itp-observation.md` (needs a genuinely same-origin deployed domain). The
  user's own decision on which domain/Vercel project to use for this.
- [ ] `docs/spikes/mp-fidelity.md`'s `ip_override` check needs a real residential/mobile IP (the
  test IP used, `8.8.8.8`, most likely got GA4 bot-filtered) — either re-run from a real IP or
  accept it'll only be confirmed by genuine end-user traffic post-launch.

## Blocked on work (do next)

- [ ] Set up CI (GitHub Actions) — no workflow exists yet running typecheck/lint/vitest/build on
  push+PR. First concrete step: add `.github/workflows/ci.yml` running the same commands as
  `pnpm run typecheck && pnpm exec vitest run && pnpm exec eslint . && pnpm run build`.
- [ ] `docs/spikes/sw-beacon-capture.md` — genuinely unattempted this session (browser binaries
  are now available, unlike when this doc was first written, but the actual beacon-capture spike
  itself — whether the SW's fetch handler observes outgoing `fetch(keepalive)`/`sendBeacon` during
  page unload — was out of scope for this pass). First step: read that doc's "To unblock" section.
- [ ] Firefox/WebKit e2e — `playwright.config.ts` declares `firefox`/`webkit` projects but only
  `chromium` is runnable in this environment (stale cached browser versions). First step:
  `pnpm exec playwright install firefox webkit` in an environment with a fresh cache, then
  `pnpm exec playwright test` (all projects, not `--project=chromium`).
- [ ] `docs/spikes/mp-fidelity.md`'s device/browser dimension check (Realtime "Tech" report) —
  attempted but the report wasn't reachable via direct URL navigation in the time available;
  needs a proper click-through via the GA4 UI nav instead.

## Nice-to-have / later

- [ ] Traffic-acquisition/Engagement report settling for `mp-fidelity.md` — needs 48h+ of steady
  traffic on a property, doesn't fit a single session.
- [ ] A GitHub Release object (with notes) for the `@gtmss/ga4-relay@0.1.1` tag — the git tag
  exists and is pushed, but no corresponding GitHub Release page was created.

## Known risks / watch-outs

- The `@gtmss` npm scope currently publishes under the personal `catesandrew` npm account (no npm
  Organization was created) — fine for now, but if collaborators are ever added, an npm org would
  need setting up separately.
- `apps/demo/.env.local` (gitignored) currently holds placeholder GA4/Upstash values seeded by the
  Playwright e2e work — anyone re-running `pnpm --filter demo build` locally needs to recreate it
  from `apps/demo/.env.example` if it's ever cleaned up.

## Done this session (for reference)

- [x] Live GA4 verification found + fixed the `session_id`/`ga_session_id` duplicate-param bug (`26c805e`)
- [x] Real Playwright e2e found + fixed the SW-serving-route 500 bug, in both dev and prod (`26c805e`)
- [x] Fixed a dev-mode double-registration hazard in the reference `Ga4Init` pattern (`26c805e`)
- [x] Added Changesets tooling (`26c805e`)
- [x] Published `@gtmss/ga4-relay@0.1.1` to the public npm registry, tagged and pushed correctly (`81e5643`)
