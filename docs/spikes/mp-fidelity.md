# M0.1 — MP v2 fidelity spike

**Status: blocked in this environment.** Requires a real GA4 property (measurement ID + api_secret) and a scratch site to compare Realtime/Traffic-acquisition/Engagement reports between MP-relayed events and gtag-instrumented events. No GA4 credentials are available in this environment, and report settling for Traffic-acquisition/Engagement can take up to 48h, which doesn't fit an automated build.

**What this blocks:** confirming whether `engagement_time_msec`/`session_id` presence is sufficient for Realtime visibility, whether device/browser/OS dimensions survive without a forwarded user-agent, and whether synthesizing `session_start`/`first_visit` from the relay's session cookie recovers part of the fidelity gap, and whether `ip_override` populates real geo dimensions (AC30).

**Default assumption taken in its absence** (per the plan's Option A cons, ADR Consequences): MP v2 has a fidelity gap vs. real sGTM (no automatic `session_start`/`first_visit`, no Google Signals, no automatic attribution) — this is accepted as a known, documented limitation of v1, not something implementation blocks on. AC30 (ip_override geo effect) is implemented and unit/integration-tested against a mock, but its full real-GA4 verification is deferred to whoever runs this spike with real credentials.

**To unblock:** provide a scratch GA4 property's `measurementId`/`api_secret` and re-run this spike per plan step 0.1.
