import { describe, expect, it } from "vitest";
import {
  exceedsBodySize,
  isValidCollectBody,
  MAX_BODY_BYTES,
  sanitizeEvent,
  splitIntoBatches,
  validateEvent,
} from "./validate.js";
import type { Ga4Event } from "../shared/event.js";

function makeEvent(overrides: Partial<Ga4Event> = {}): Ga4Event {
  return { event_id: "id-1", name: "page_view", params: {}, ...overrides };
}

describe("validate.ts", () => {
  describe("validateEvent", () => {
    it("accepts a well-formed event", () => {
      const result = validateEvent(makeEvent());
      expect(result.valid).toBe(true);
    });

    it("AC11: rejects (does not truncate) an event name over 40 chars", () => {
      const result = validateEvent(makeEvent({ name: "a".repeat(41) }));
      expect(result).toEqual({ valid: false, reason: "name-too-long" });
    });

    it("AC11: rejects a param value over 100 chars", () => {
      const result = validateEvent(makeEvent({ params: { x: "a".repeat(101) } }));
      expect(result).toEqual({ valid: false, reason: "value-too-long" });
    });

    it("rejects an event with more than 25 params", () => {
      const params = Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`p${i}`, "v"]));
      const result = validateEvent(makeEvent({ params }));
      expect(result).toEqual({ valid: false, reason: "too-many-params" });
    });

    it("PII deny-list: rejects an email-shaped param value", () => {
      const result = validateEvent(makeEvent({ params: { note: "contact me at a@b.com" } }));
      expect(result).toEqual({ valid: false, reason: "pii-detected" });
    });

    it("PII deny-list: rejects a phone-shaped param value", () => {
      const result = validateEvent(makeEvent({ params: { note: "call 555-123-4567" } }));
      expect(result).toEqual({ valid: false, reason: "pii-detected" });
    });

    it("rejects a configured blocked param name", () => {
      const result = validateEvent(makeEvent({ params: { ssn: "123" } }), { blockedParamNames: ["ssn"] });
      expect(result).toEqual({ valid: false, reason: "blocked-param" });
    });

    it("user_id policy: rejects a non-pre-hashed value", () => {
      const result = validateEvent(makeEvent({ params: { user_id: "raw-user-id" } }));
      expect(result).toEqual({ valid: false, reason: "invalid-user-id" });
    });

    it("user_id policy: accepts a SHA-256 hex value", () => {
      const sha256Hex = "a".repeat(64);
      const result = validateEvent(makeEvent({ params: { user_id: sha256Hex } }));
      expect(result.valid).toBe(true);
    });

    it("rejects an event name that doesn't match GA4's grammar (unicode, HTML, etc)", () => {
      // A prior version accepted anything under the length limit, and MP
      // doesn't reliably report the rejection back (codex critic review
      // round 4, reproduced live: 200 + forwarded for these exact values).
      expect(validateEvent(makeEvent({ name: "事件" }))).toEqual({ valid: false, reason: "invalid-name-grammar" });
      expect(validateEvent(makeEvent({ name: "<script>" }))).toEqual({ valid: false, reason: "invalid-name-grammar" });
      expect(validateEvent(makeEvent({ name: "1_starts_with_digit" }))).toEqual({
        valid: false,
        reason: "invalid-name-grammar",
      });
    });

    it("rejects a param name that doesn't match GA4's grammar", () => {
      const result = validateEvent(makeEvent({ params: { "bad-key": "v" } }));
      expect(result).toEqual({ valid: false, reason: "invalid-param-name" });
    });

    it("rejects a non-primitive (object/array) param value", () => {
      expect(validateEvent(makeEvent({ params: { nested: { a: 1 } as unknown as string } }))).toEqual({
        valid: false,
        reason: "invalid-param-value-type",
      });
    });
  });

  describe("sanitizeEvent — query-string scrubbing", () => {
    it("strips the query string from page_location", () => {
      const sanitized = sanitizeEvent(
        makeEvent({ params: { page_location: "https://x.com/path?email=leak@x.com" } }),
      );
      expect(sanitized.params.page_location).toBe("https://x.com/path");
    });

    it("strips the query string from page_referrer", () => {
      const sanitized = sanitizeEvent(makeEvent({ params: { page_referrer: "https://x.com/?token=abc" } }));
      expect(sanitized.params.page_referrer).toBe("https://x.com/");
    });
  });

  describe("splitIntoBatches (AC10)", () => {
    it("splits a 40-event batch into two batches of <=25", () => {
      const events = Array.from({ length: 40 }, (_, i) => makeEvent({ event_id: String(i) }));
      const batches = splitIntoBatches(events);
      expect(batches).toHaveLength(2);
      expect(batches[0]).toHaveLength(25);
      expect(batches[1]).toHaveLength(15);
    });
  });

  describe("isValidCollectBody", () => {
    it("accepts a well-formed body", () => {
      expect(isValidCollectBody({ events: [makeEvent()] })).toBe(true);
    });

    it("rejects a null event in the array instead of letting it reach validateEvent", () => {
      // A prior version threw a TypeError on this shape instead of a clean
      // 400 (codex critic review round 2, reproduced live).
      expect(isValidCollectBody({ events: [null] })).toBe(false);
    });

    it("rejects a non-array events field", () => {
      expect(isValidCollectBody({ events: "not-an-array" })).toBe(false);
    });

    it("rejects a non-object body", () => {
      expect(isValidCollectBody(null)).toBe(false);
      expect(isValidCollectBody("a string")).toBe(false);
    });

    it("rejects an event missing name/params", () => {
      expect(isValidCollectBody({ events: [{ event_id: "1" }] })).toBe(false);
    });

    it("rejects a malformed replay object instead of letting it reach the HMAC verifier", () => {
      expect(isValidCollectBody({ events: [makeEvent()], replay: {} })).toBe(false);
      expect(isValidCollectBody({ events: [makeEvent()], replay: { client_id: "x" } })).toBe(false);
    });

    it("accepts a well-formed replay object", () => {
      expect(
        isValidCollectBody({
          events: [makeEvent()],
          replay: { client_id: "c", ga_session_id: "s", ga_session_number: 1, issued_at: 1, signature: "sig" },
        }),
      ).toBe(true);
    });

    it("rejects params as an array (typeof [] === 'object' previously slipped through)", () => {
      expect(isValidCollectBody({ events: [{ event_id: "1", name: "page_view", params: [null] }] })).toBe(false);
    });

    it("rejects an envelope with more than MAX_EVENTS_PER_ENVELOPE events", () => {
      const events = Array.from({ length: 251 }, () => makeEvent());
      expect(isValidCollectBody({ events })).toBe(false);
    });
  });

  describe("exceedsBodySize", () => {
    it("flags a body over the MP limit", () => {
      expect(exceedsBodySize(MAX_BODY_BYTES + 1)).toBe(true);
      expect(exceedsBodySize(MAX_BODY_BYTES)).toBe(false);
    });
  });
});
