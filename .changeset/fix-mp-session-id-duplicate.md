---
"@gtmss/ga4-relay": patch
---

Fix `buildMpPayload` sending a redundant `session_id` event param alongside `ga_session_id`, which a live GA4 debug/mp/collect check flagged as `NAME_DUPLICATED` (GA4 canonicalizes `ga_session_id` to the same internal session field). Only `ga_session_id`/`ga_session_number`/`engagement_time_msec` are sent now.
