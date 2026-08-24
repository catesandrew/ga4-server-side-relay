# M0.3 — Google-native first-party mode check

**Status: blocked in this environment.** Requires a live Vercel deployment and a real `gtag`-instrumented site to verify whether Google's own first-party mode for Google tags is usable on Vercel deployments. No deployed environment is available here.

**What this blocks:** scoping M3.1 (script-loading/proxying for `gtag.js`) around a supported mechanism instead of building parallel plumbing. Per the plan (1.7), this spike has **no bearing** on the Edge-vs-Node runtime choice for the collect handler — that's decided independently on latency/library-compatibility grounds, which US-007 does without needing this spike.

**Default assumption taken in its absence:** M3.1 (script proxying) stays out of v1 scope, as the plan already specifies — nothing in M1/M2 implementation depends on this spike's outcome.

**To unblock:** deploy `apps/demo` to a real Vercel project and test `gtag('config', ..., { server_container_url: ... })` against it.
