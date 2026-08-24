import { describe, expect, it } from "vitest";
import { newId, signPayload, verifySignature } from "./hmac.js";

describe("hmac", () => {
  it("signs and verifies a matching payload/secret", async () => {
    const sig = await signPayload("hello", "secret");
    expect(await verifySignature("hello", sig, "secret")).toBe(true);
  });

  it("rejects a tampered payload", async () => {
    const sig = await signPayload("hello", "secret");
    expect(await verifySignature("goodbye", sig, "secret")).toBe(false);
  });

  it("rejects a signature produced with a different secret", async () => {
    const sig = await signPayload("hello", "secret-a");
    expect(await verifySignature("hello", sig, "secret-b")).toBe(false);
  });

  it("newId returns distinct UUIDs", () => {
    const a = newId();
    const b = newId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
