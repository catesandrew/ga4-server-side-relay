import { describe, expect, it } from "vitest";
import {
  mintToken,
  reissueTokenIfNeeded,
  signCaptureIdentity,
  verifyReplayIdentity,
  verifyToken,
} from "./token.js";

const SECRET = "test-token-secret";

describe("token.ts", () => {
  it("verifies a freshly minted token", async () => {
    const token = await mintToken("https://example.com", SECRET);
    const result = await verifyToken(token, SECRET);
    expect(result.valid).toBe(true);
    expect(result.payload?.origin).toBe("https://example.com");
  });

  it("AC8: rejects a missing token", async () => {
    const result = await verifyToken(undefined, SECRET);
    expect(result.valid).toBe(false);
  });

  it("AC8: rejects an expired token", async () => {
    const now = 1_000_000;
    const token = await mintToken("https://example.com", SECRET, now);
    const result = await verifyToken(token, SECRET, now + 16 * 60 * 1000);
    expect(result.valid).toBe(false);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await mintToken("https://example.com", "other-secret");
    const result = await verifyToken(token, SECRET);
    expect(result.valid).toBe(false);
  });

  describe("reissueTokenIfNeeded — reissue condition", () => {
    it("mints a fresh token (new kid) when no cookie is present", async () => {
      const { token, reissued } = await reissueTokenIfNeeded(undefined, "https://example.com", SECRET);
      expect(reissued).toBe(true);
      const verified = await verifyToken(token, SECRET);
      expect(verified.valid).toBe(true);
    });

    it("AC29 prerequisite: passes an existing valid token through unchanged (same kid persists)", async () => {
      const first = await mintToken("https://example.com", SECRET);
      const { token, reissued } = await reissueTokenIfNeeded(first, "https://example.com", SECRET);
      expect(reissued).toBe(false);
      expect(token).toBe(first);
    });

    it("mints a fresh token when a valid existing token was minted for a DIFFERENT origin", async () => {
      // A prior version only checked validity/expiry, so a multi-origin
      // install's second origin reused the first origin's token — which
      // the collect handler's origin-binding check then rejected forever
      // (codex critic review round 2, reproduced live).
      const forOriginA = await mintToken("https://a.example.com", SECRET);
      const { token, reissued } = await reissueTokenIfNeeded(forOriginA, "https://b.example.com", SECRET);
      expect(reissued).toBe(true);
      const verified = await verifyToken(token, SECRET);
      expect(verified.payload?.origin).toBe("https://b.example.com");
    });

    it("mints a fresh token when the existing one is expired", async () => {
      const now = 1_000_000;
      const stale = await mintToken("https://example.com", SECRET, now);
      const { token, reissued } = await reissueTokenIfNeeded(
        stale,
        "https://example.com",
        SECRET,
        now + 16 * 60 * 1000,
      );
      expect(reissued).toBe(true);
      expect(token).not.toBe(stale);
    });
  });

  describe("capture identity sign/verify (AC22/AC24)", () => {
    it("accepts a valid, matching replay", async () => {
      const identity = { client_id: "abc.123", ga_session_id: "sess1", ga_session_number: 2 };
      const signed = await signCaptureIdentity(identity, SECRET);
      const verdict = await verifyReplayIdentity(signed, "abc.123", SECRET);
      expect(verdict.ok).toBe(true);
    });

    it("AC22: rejects a tampered/invalid signature", async () => {
      const identity = { client_id: "abc.123", ga_session_id: "sess1", ga_session_number: 2 };
      const signed = await signCaptureIdentity(identity, SECRET);
      const tampered = { ...signed, signature: "not-a-real-signature" };
      const verdict = await verifyReplayIdentity(tampered, "abc.123", SECRET);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.reason).toBe("invalid-signature");
    });

    it("AC24: rejects a valid signature whose client_id doesn't match the live cookie", async () => {
      const identity = { client_id: "attacker.999", ga_session_id: "sess1", ga_session_number: 2 };
      const signed = await signCaptureIdentity(identity, SECRET);
      const verdict = await verifyReplayIdentity(signed, "victim.111", SECRET);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.reason).toBe("client-id-mismatch");
    });

    it("rejects a replay older than the 48h bound even with a valid signature", async () => {
      const now = 1_000_000_000;
      const identity = { client_id: "abc.123", ga_session_id: "sess1", ga_session_number: 2 };
      const signed = await signCaptureIdentity(identity, SECRET, now);
      const verdict = await verifyReplayIdentity(signed, "abc.123", SECRET, now + 49 * 60 * 60 * 1000);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.reason).toBe("expired");
    });
  });
});
