---
name: project-ga4-relay-release
description: "gtm-server-side is a public GA4 server-side relay package (@gtmss/ga4-relay), published to npm + GitHub, currently at 0.1.1"
metadata: 
  node_type: memory
  type: project
  originSessionId: f3c42a95-b6eb-491f-97dd-293e0da78b05
  modified: 2026-08-24T18:12:06.606Z
---

`gtm-server-side` (this repo) builds `@gtmss/ga4-relay` — a self-hosted, first-party GA4
Measurement Protocol v2 relay for Next.js/Vercel, with a service-worker resilience layer.
Public GitHub repo: `catesandrew/ga4-server-side-relay`. Public npm package: `@gtmss/ga4-relay`,
currently `0.1.1`.

**Why:** built via a RALPLAN-DR consensus plan + Ralph implementation loop (7 rounds of
adversarial codex review), then deliberately live-verified against a real GA4 property
(`catesworks.dev`, using credentials at `/Volumes/dev-ssd/repos/personal/docs/ga4-credentials.md`,
sensitive, not tracked in any repo) and real-browser Playwright e2e once outbound network access
became available in the working environment. That live verification found and fixed two real bugs
that 165 passing unit tests had missed — see the session dossier.

**How to apply:** full session dossier (summary, lessons, an ADR on the fix's bundle-isolation
design, open follow-ups, a draft public blog post) lives at
`docs/sessions/2026-08-24-ga4-relay-fixes-release/` in this repo — read that dossier's `README.md`
first before resuming or extending this work. Known-open items (all pre-existing, environment-blocked
spikes, see `docs/spikes/*.md` and the dossier's `FOLLOWUPS.md`): no real Vercel deployment yet
(blocks the first-party-mode and Safari ITP spikes), no CI/GitHub Actions workflow yet,
Firefox/WebKit e2e not runnable (stale cached browser versions), `ip_override`'s geo-dimension
effect still unconfirmed (test IP got likely bot-filtered).
