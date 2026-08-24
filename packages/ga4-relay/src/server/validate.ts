import type { CollectRequestBody, Ga4Event } from "../shared/event.js";

export const MAX_EVENTS_PER_REQUEST = 25;
export const MAX_PARAMS_PER_EVENT = 25;
export const MAX_NAME_LENGTH = 40;
export const MAX_VALUE_LENGTH = 100;
/** MP's documented request body limit (checked independently of event/param count). */
export const MAX_BODY_BYTES = 130 * 1024;

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_RE = /(?:\+?\d[\s.-]?){7,}\d/;
const SHA256_HEX_RE = /^[a-f0-9]{64}$/i;
const QUERY_SCRUB_PARAMS = new Set(["page_location", "page_referrer"]);

const EVENT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
// GA4's own event/param name grammar: must start with a letter, then only
// alphanumerics/underscores. A prior version accepted anything under the
// length limit — unicode, `<script>`, hyphens — and forwarded it to MP,
// which doesn't reliably report the rejection back (codex critic review
// round 4, reproduced live: 200 + forwarded for "事件", "<script>", etc).
const NAME_GRAMMAR_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
/** Envelope cap on events per REQUEST (distinct from MAX_EVENTS_PER_REQUEST, which bounds the outbound MP batch after splitting) — an authenticated request with thousands of events ran thousands of dedupe calls and produced dozens of MP batches before this existed. */
export const MAX_EVENTS_PER_ENVELOPE = 250;

export type DropReason =
  | "name-too-long"
  | "value-too-long"
  | "too-many-params"
  | "pii-detected"
  | "blocked-param"
  | "invalid-user-id"
  | "invalid-event-id"
  | "invalid-name-grammar"
  | "invalid-param-name"
  | "invalid-param-value-type";

export type ValidationResult =
  | { valid: true; event: Ga4Event }
  | { valid: false; reason: DropReason };

export interface ValidateConfig {
  /** Additional param names to reject outright, beyond the built-in PII deny-list. */
  blockedParamNames?: string[];
}

/** Strips query strings from page_location/page_referrer — the highest-frequency real PII leak. */
export function sanitizeEvent(event: Ga4Event): Ga4Event {
  const params = { ...event.params };
  for (const key of QUERY_SCRUB_PARAMS) {
    const value = params[key];
    if (typeof value === "string") {
      const qIndex = value.indexOf("?");
      if (qIndex !== -1) params[key] = value.slice(0, qIndex);
    }
  }
  return { ...event, params };
}

function isPlainParamsObject(value: unknown): value is Ga4Event["params"] {
  // `typeof [] === "object"` and `[] !== null` — an array previously
  // passed this check despite being invalid `params`, then silently
  // produced malformed output via Object.entries' numeric-index iteration
  // instead of being rejected (codex critic review round 3, reproduced
  // live: `params:[null]` returned 200 and was forwarded as "valid").
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates the request body's SHAPE before anything downstream
 * dereferences it — `body.events` items were previously trusted to be
 * objects, so `{ events: [null] }` on an otherwise-authenticated request
 * threw a TypeError instead of returning a clean 400 (codex critic review
 * round 2, reproduced live). Round 3 (reproduced live: a 500 crash) added
 * `replay` shape validation — a malformed `replay: {}` reached the HMAC
 * verifier with `signature` as `undefined`.
 */
export function isValidCollectBody(body: unknown): body is CollectRequestBody {
  if (typeof body !== "object" || body === null) return false;
  const candidate = body as Record<string, unknown>;
  if (!Array.isArray(candidate.events)) return false;
  if (candidate.events.length > MAX_EVENTS_PER_ENVELOPE) return false;
  const eventsValid = candidate.events.every(
    (event) =>
      typeof event === "object" &&
      event !== null &&
      typeof (event as Record<string, unknown>).name === "string" &&
      isPlainParamsObject((event as Record<string, unknown>).params),
  );
  if (!eventsValid) return false;

  if (candidate.replay !== undefined) {
    if (typeof candidate.replay !== "object" || candidate.replay === null) return false;
    const replay = candidate.replay as Record<string, unknown>;
    if (
      typeof replay.client_id !== "string" ||
      typeof replay.ga_session_id !== "string" ||
      typeof replay.ga_session_number !== "number" ||
      typeof replay.issued_at !== "number" ||
      typeof replay.signature !== "string"
    ) {
      return false;
    }
  }

  return true;
}

export function validateEvent(rawEvent: Ga4Event, config: ValidateConfig = {}): ValidationResult {
  // event_id becomes a Redis dedupe key (dedupe-store.ts) — reject before
  // that happens rather than letting an arbitrary/absent value through.
  if (typeof rawEvent.event_id !== "string" || !EVENT_ID_RE.test(rawEvent.event_id)) {
    return { valid: false, reason: "invalid-event-id" };
  }

  const event = sanitizeEvent(rawEvent);
  const blocked = new Set((config.blockedParamNames ?? []).map((n) => n.toLowerCase()));

  // AC11: reject outright, never truncate — truncation silently merges distinct event names.
  if (event.name.length > MAX_NAME_LENGTH) {
    return { valid: false, reason: "name-too-long" };
  }
  if (!NAME_GRAMMAR_RE.test(event.name)) {
    return { valid: false, reason: "invalid-name-grammar" };
  }

  const paramEntries = Object.entries(event.params);
  if (paramEntries.length > MAX_PARAMS_PER_EVENT) {
    return { valid: false, reason: "too-many-params" };
  }

  for (const [key, value] of paramEntries) {
    const lowerKey = key.toLowerCase();

    if (!NAME_GRAMMAR_RE.test(key)) {
      return { valid: false, reason: "invalid-param-name" };
    }

    if (lowerKey === "user_id") {
      if (typeof value !== "string" || !SHA256_HEX_RE.test(value)) {
        return { valid: false, reason: "invalid-user-id" };
      }
      continue;
    }

    if (blocked.has(lowerKey)) {
      return { valid: false, reason: "blocked-param" };
    }

    // Only string/number/boolean are valid MP param values — a nested
    // object/array previously passed through untouched (no length/PII
    // check applies to non-strings), silently forwarded as malformed MP
    // data (codex critic review round 4, reproduced live).
    if (value !== null && typeof value === "object") {
      return { valid: false, reason: "invalid-param-value-type" };
    }

    if (typeof value === "string") {
      if (value.length > MAX_VALUE_LENGTH) {
        return { valid: false, reason: "value-too-long" };
      }
      if (EMAIL_RE.test(value) || PHONE_RE.test(value)) {
        return { valid: false, reason: "pii-detected" };
      }
    }
  }

  return { valid: true, event };
}

/** AC10: batches larger than the MP limit are split, never dropped or over-sent. */
export function splitIntoBatches(events: Ga4Event[], maxSize = MAX_EVENTS_PER_REQUEST): Ga4Event[][] {
  const batches: Ga4Event[][] = [];
  for (let i = 0; i < events.length; i += maxSize) {
    batches.push(events.slice(i, i + maxSize));
  }
  return batches;
}

export function exceedsBodySize(bodyBytes: number): boolean {
  return bodyBytes > MAX_BODY_BYTES;
}
