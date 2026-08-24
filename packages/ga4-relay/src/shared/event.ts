/**
 * Normalized internal event shape shared by the client SDK and the
 * server-side collect handler (plan step 1.10). Backs M3.2's destination-
 * fan-out additivity claim — a real home instead of an aspiration.
 */
export interface Ga4EventParams {
  [key: string]: string | number | boolean;
}

export interface Ga4Event {
  /** Client-generated UUID, used for server-side dedupe (AC9). */
  event_id: string;
  name: string;
  params: Ga4EventParams;
}

export interface ConsentSignal {
  ad_storage: "granted" | "denied";
  ad_user_data: "granted" | "denied";
  ad_personalization: "granted" | "denied";
  analytics_storage: "granted" | "denied";
}

export interface CollectRequestBody {
  events: Ga4Event[];
  consent?: ConsentSignal;
  /** Present only when this is a replay of a previously queued (offline) event. */
  replay?: SignedCaptureIdentity;
  /**
   * When replaying a queued event, the time it was actually CAPTURED
   * (queue.ts's `capturedAt`) — distinct from `replay.issued_at`, which is
   * when the cached identity was minted and can predate the event by
   * however long that identity has been reused across multiple events.
   * Client-asserted like any analytics timestamp; the server bounds it
   * (not in the future, not older than the 48h queue TTL) before trusting
   * it for `timestamp_micros`.
   */
  capturedAtMs?: number;
}

export interface CaptureIdentity {
  client_id: string;
  ga_session_id: string;
  ga_session_number: number;
}

export interface SignedCaptureIdentity extends CaptureIdentity {
  issued_at: number;
  signature: string;
}
