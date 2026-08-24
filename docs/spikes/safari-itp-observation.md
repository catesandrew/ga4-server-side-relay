# M0.4 — Safari ITP cookie-longevity observation

**Status: blocked in this environment.** Requires an 8+ day real-Safari observation against a deployed, genuinely same-origin site — not reproducible in a single automated pass, and no Safari/WebKit device with persistent state across days is available here.

**What this blocks:** empirically confirming the ADR's claim that a genuinely same-origin `Set-Cookie` is not subject to ITP's 7-day `document.cookie` cap (the cap applies to script-set/CNAME-cloaked cookies, not server-set same-origin ones, by ITP's own documented design).

**Default assumption taken in its absence** (per the plan's ADR): the cookie-longevity advantage over CNAME-based vendors is stated as **mechanism-derived** but **not yet empirically validated** — this qualifier stays in the ADR and in this repo until a real 8-day observation reports. Implementation is not blocked on this: `cookies.ts` (US-002) sets a standard `Max-Age=63072000` server-side cookie regardless of the outcome, since that's the correct implementation either way — the spike only confirms how long it actually survives in Safari specifically.

**To unblock:** deploy `apps/demo` to a real same-origin domain and track the `client_id` cookie's survival in Safari over 8+ days.
