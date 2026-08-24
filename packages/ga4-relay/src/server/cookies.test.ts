import { describe, expect, it } from "vitest";
import {
  parseGaCookie,
  resolveClientId,
  resolveSession,
  unwrapClientId,
  wrapClientId,
} from "./cookies.js";

describe("cookies.ts", () => {
  it("wraps and unwraps the v1: version prefix", () => {
    const wrapped = wrapClientId("abc-123");
    expect(wrapped).toBe("v1:abc-123");
    expect(unwrapClientId(wrapped)).toBe("abc-123");
  });

  it("unwrapClientId is a no-op on an unprefixed value", () => {
    expect(unwrapClientId("abc-123")).toBe("abc-123");
  });

  describe("parseGaCookie (AC3)", () => {
    it("extracts <random>.<timestamp> from a real _ga cookie shape", () => {
      expect(parseGaCookie("GA1.1.123456789.987654321")).toBe("123456789.987654321");
    });

    it("returns null for an absent or malformed cookie", () => {
      expect(parseGaCookie(undefined)).toBeNull();
      expect(parseGaCookie("not-a-ga-cookie")).toBeNull();
    });
  });

  describe("resolveClientId", () => {
    it("AC2: mints a new v1:-prefixed UUID when no cookie or _ga cookie exists", () => {
      const result = resolveClientId({ existingCookie: undefined, gaCookie: undefined });
      expect(result.isNew).toBe(true);
      expect(result.cookieValue).toMatch(/^v1:/);
      expect(result.raw).not.toMatch(/^v1:/);
    });

    it("AC2: reuses an existing wrapped cookie, unwrapped for the raw value", () => {
      const result = resolveClientId({ existingCookie: "v1:abc-123", gaCookie: undefined });
      expect(result.isNew).toBe(false);
      expect(result.raw).toBe("abc-123");
      expect(result.cookieValue).toBe("v1:abc-123");
    });

    it("AC3: derives from an existing _ga cookie when no relay cookie is present", () => {
      const result = resolveClientId({ existingCookie: undefined, gaCookie: "GA1.1.111.222" });
      expect(result.isNew).toBe(true);
      expect(result.raw).toBe("111.222");
    });

    it("AC3: prefers the existing relay cookie over _ga when both are present", () => {
      const result = resolveClientId({ existingCookie: "v1:already-set", gaCookie: "GA1.1.111.222" });
      expect(result.raw).toBe("already-set");
    });
  });

  describe("resolveSession (AC4)", () => {
    it("keeps the same session_id within the 30-min window and updates lastSeen", () => {
      const now = 1_000_000;
      const first = resolveSession(undefined, now);
      const fiveMinLater = `${first.ga_session_id}:${first.ga_session_number}:${first.lastSeen}`;
      const second = resolveSession(fiveMinLater, now + 5 * 60 * 1000);
      expect(second.ga_session_id).toBe(first.ga_session_id);
      expect(second.ga_session_number).toBe(first.ga_session_number);
    });

    it("mints a new session_id and increments ga_session_number after 31+ minutes", () => {
      const now = 1_000_000;
      const first = resolveSession(undefined, now);
      const serialized = `${first.ga_session_id}:${first.ga_session_number}:${first.lastSeen}`;
      const second = resolveSession(serialized, now + 31 * 60 * 1000);
      expect(second.ga_session_id).not.toBe(first.ga_session_id);
      expect(second.ga_session_number).toBe(first.ga_session_number + 1);
    });
  });
});
