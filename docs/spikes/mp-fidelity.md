# M0.1 — MP v2 fidelity spike

**Status: partially unblocked (2026-08-24) — live-verified against a real GA4 property.**

Verified live against `catesworks.dev` (GA4 property 551179302, measurement ID `G-YC0JKCQVXY`),
using the package's own `buildMpPayload`/`collectUrl`/`debugCollectUrl` shape sent directly at
`/debug/mp/collect` and `/mp/collect`:

- **Real bug found and fixed**: `buildMpPayload` sent both a manual `session_id` param *and*
  `ga_session_id`. GA4's live debug endpoint flagged this as `NAME_DUPLICATED` — GA4 canonicalizes
  `ga_session_id` to the same internal session field, so the redundant `session_id` collided
  with it instead of adding information. Fixed in `src/server/mp-client.ts` (only `ga_session_id`/
  `ga_session_number`/`engagement_time_msec` are sent now); see `mp-client.test.ts` for the
  regression test and the package CHANGELOG for the release note.
- **Realtime visibility confirmed**: after the fix, a `POST /mp/collect` with only
  `ga_session_id`/`ga_session_number`/`engagement_time_msec` (no `session_start`/`first_visit`,
  no gtag.js involved) returned `204` and the event (`mp_relay_spike_verification`) appeared in
  GA4's Realtime "Event count by Event name" report within ~30-60s, with "Active users in last
  30 minutes" incrementing. This confirms the M0.1 finding (a) assumption baked into
  `buildMpPayload` was directionally correct, modulo the duplicate-param bug above.
- **`ip_override` (AC30): inconclusive, not a negative result.** Two follow-up events sent with
  `ip_override: "8.8.8.8"` (Google Public DNS — a well-known non-residential/datacenter IP) never
  appeared in Realtime, despite both returning `204`. The most likely explanation is GA4's bot/
  spam filtering excluding traffic from a widely-recognized datacenter IP, not a failure of
  `ip_override` itself — real customer traffic comes from residential/mobile IPs, so this
  artifact is specific to the synthetic test IP chosen, not the relay's implementation. Re-running
  this check with a real residential/mobile IP (or accepting that this can only be confirmed from
  genuine end-user traffic post-launch) would close this out fully.
- **Device/browser dimension fidelity from a forwarded user-agent header alone**: not conclusively
  checked in this pass — the Realtime "Tech" report wasn't reachable via direct URL navigation in
  the time available, and chasing this further had diminishing returns relative to the two
  confirmed findings above. Still open.

**Still blocked / out of scope for a single pass**: Traffic-acquisition and Engagement report
settling can take up to 48h, which doesn't fit a single automated verification session. Whether
synthesizing `session_start`/`first_visit` from the relay's session cookie would further close
the fidelity gap vs. real sGTM is also still untested — the events sent in this spike were sent
without those synthesized events, on purpose, to isolate the base MP v2 fidelity question first.

**Default assumption from the original plan (still holds as the baseline)**: MP v2 has a fidelity
gap vs. real sGTM (no automatic `session_start`/`first_visit`, no Google Signals, no automatic
attribution) — accepted as a known, documented limitation of v1, not something implementation
blocks on.

**To fully close this spike**: re-run the `ip_override` check from a real residential/mobile IP
(or wait for genuine end-user traffic), check the Realtime Tech report for device/browser
dimension population, and let a Traffic-acquisition/Engagement report settle for 48h+ on a
property receiving steady synthetic or real traffic.
