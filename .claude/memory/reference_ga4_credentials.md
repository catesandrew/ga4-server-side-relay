---
name: reference-ga4-credentials
description: "Where live GA4 Measurement Protocol credentials for testing live, and how to verify against real GA4 in this environment"
metadata: 
  node_type: memory
  type: reference
  originSessionId: f3c42a95-b6eb-491f-97dd-293e0da78b05
  modified: 2026-08-24T18:12:15.893Z
---

Real GA4 accounts (account "catesworks", account ID 405697686) with per-domain Measurement
Protocol API secrets live at `/Volumes/dev-ssd/repos/personal/docs/ga4-credentials.md` — deliberately
outside git tracking, sensitive, do not commit anywhere. Covers ~15 personal-project domains, each
with one Web data stream + one MP API secret named `posthog-forwarder`.

**How to apply:** for live GA4 Measurement Protocol verification (not just mocked/unit tests),
use one of these domains' credentials with `catesworks.dev` as the default low-stakes scratch
target (confirmed with the user 2026-08-24 — `catesdev.sh` has nothing deployed yet, `catesworks.dev`
has a simple real landing page in a separate `../cates-works-dev` repo). Chrome MCP tools are
available and already signed into the Google account that owns this GA4 property — use it to
check GA4's Realtime UI directly rather than only trusting HTTP status codes from the MP endpoint.
Mark synthetic test events clearly (distinct event names, e.g. `..._spike_verification`) so
they're identifiable in reporting.
