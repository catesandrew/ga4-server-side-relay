import type { ConsentSignal, Ga4Event } from "../shared/event.js";

export interface MpConfig {
  measurementId: string;
  apiSecret: string;
  region?: "us" | "eu";
  /** Override for tests — points at the mock MP server instead of Google's real endpoints. */
  endpointBaseOverride?: string;
}

function endpointBase(config: MpConfig): string {
  if (config.endpointBaseOverride) return config.endpointBaseOverride;
  return config.region === "eu"
    ? "https://region1.google-analytics.com"
    : "https://www.google-analytics.com";
}

function mpUrl(config: MpConfig, path: string): string {
  const url = new URL(`${endpointBase(config)}${path}`);
  url.searchParams.set("measurement_id", config.measurementId);
  url.searchParams.set("api_secret", config.apiSecret);
  return url.toString();
}

export function collectUrl(config: MpConfig): string {
  return mpUrl(config, "/mp/collect");
}

export function debugCollectUrl(config: MpConfig): string {
  return mpUrl(config, "/debug/mp/collect");
}

export interface MpPayload {
  client_id: string;
  events: Array<{ name: string; params: Record<string, unknown> }>;
  ip_override?: string;
  /** Backdates the event up to 72h — used for replayed/queued events so MP sees capture time, not flush time. */
  timestamp_micros?: number;
  consent?: {
    ad_user_data?: "GRANTED" | "DENIED";
    ad_personalization?: "GRANTED" | "DENIED";
  };
}

export interface BuildPayloadParams {
  clientId: string;
  events: Ga4Event[];
  sessionId: string;
  sessionNumber: number;
  ipOverride?: string;
  consent?: ConsentSignal;
  /** Epoch milliseconds at capture time (AC6b/AC12) — converted to the micros MP expects. */
  capturedAtMs?: number;
  /**
   * Canonical `@idhub/identity-core` anonymous id (US-011). Deliberately
   * distinct from `clientId`/GA4's own client_id cookie — forwarded as a
   * custom event param, never merged with or substituted for client_id, so
   * downstream joins can stitch GA4 events to the cross-vendor identity
   * graph without disturbing GA4's own client_id semantics.
   */
  anonymousId?: string;
}

function toMpConsentField(value: ConsentSignal["ad_user_data"]): "GRANTED" | "DENIED" {
  return value === "granted" ? "GRANTED" : "DENIED";
}

/**
 * Auto-injects the session/engagement params MP needs for Realtime visibility (M0.1 finding a).
 * Only `ga_session_id`/`ga_session_number` are set — a live GA4 debug/mp/collect check (M0.1,
 * re-verified 2026-08-24 against a real property) flagged a redundant `session_id` param as
 * NAME_DUPLICATED: GA4 canonicalizes `ga_session_id` to the same internal session field, so
 * also sending `session_id` collides with it rather than adding information.
 */
export function buildMpPayload(params: BuildPayloadParams): MpPayload {
  return {
    client_id: params.clientId,
    ip_override: params.ipOverride,
    timestamp_micros: params.capturedAtMs !== undefined ? params.capturedAtMs * 1000 : undefined,
    consent: params.consent
      ? {
          ad_user_data: toMpConsentField(params.consent.ad_user_data),
          ad_personalization: toMpConsentField(params.consent.ad_personalization),
        }
      : undefined,
    events: params.events.map((event) => ({
      name: event.name,
      params: {
        ...event.params,
        engagement_time_msec: 1,
        ga_session_id: params.sessionId,
        ga_session_number: params.sessionNumber,
        // US-011: custom param carrying the canonical @idhub anonymous id
        // alongside GA4's own identifiers; JSON.stringify drops this key
        // when undefined (callers that don't pass one are unaffected).
        idhub_anonymous_id: params.anonymousId,
      },
    })),
  };
}

export async function sendToMp(
  payload: MpPayload,
  config: MpConfig,
  headers?: { userAgent?: string },
): Promise<void> {
  await fetch(collectUrl(config), {
    method: "POST",
    body: JSON.stringify(payload),
    headers: {
      "content-type": "application/json",
      ...(headers?.userAgent ? { "user-agent": headers.userAgent } : {}),
    },
  });
  // MP returns 2xx regardless of payload validity — nothing to read here.
  // /debug/mp/collect (validateWithMp below) is the only way to catch schema issues.
}

export interface MpValidationResponse {
  validationMessages: unknown[];
}

export async function validateWithMp(payload: MpPayload, config: MpConfig): Promise<MpValidationResponse> {
  const res = await fetch(debugCollectUrl(config), {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "content-type": "application/json" },
  });
  return (await res.json()) as MpValidationResponse;
}
