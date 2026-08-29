import { describe, expect, it } from "vitest";
import { buildMpPayload, collectUrl, debugCollectUrl } from "./mp-client.js";

describe("mp-client.ts", () => {
  it("builds the global collect URL with measurement_id and api_secret", () => {
    const url = collectUrl({ measurementId: "G-TEST", apiSecret: "sekret" });
    expect(url).toContain("https://www.google-analytics.com/mp/collect");
    expect(url).toContain("measurement_id=G-TEST");
    expect(url).toContain("api_secret=sekret");
  });

  it("uses the EU regional endpoint when configured", () => {
    const url = collectUrl({ measurementId: "G-TEST", apiSecret: "sekret", region: "eu" });
    expect(url).toContain("https://region1.google-analytics.com/mp/collect");
  });

  it("builds the debug endpoint URL", () => {
    const url = debugCollectUrl({ measurementId: "G-TEST", apiSecret: "sekret" });
    expect(url).toContain("/debug/mp/collect");
  });

  it("respects endpointBaseOverride for tests", () => {
    const url = collectUrl({ measurementId: "G-TEST", apiSecret: "sekret", endpointBaseOverride: "http://localhost:1234" });
    expect(url.startsWith("http://localhost:1234/mp/collect")).toBe(true);
  });

  it("buildMpPayload auto-injects session/engagement params (M0.1 fidelity finding a)", () => {
    const payload = buildMpPayload({
      clientId: "cid",
      events: [{ event_id: "e1", name: "page_view", params: { custom: "x" } }],
      sessionId: "sess1",
      sessionNumber: 3,
      ipOverride: "1.2.3.4",
    });
    expect(payload.client_id).toBe("cid");
    expect(payload.ip_override).toBe("1.2.3.4");
    expect(payload.events[0]?.params).toMatchObject({
      custom: "x",
      ga_session_id: "sess1",
      ga_session_number: 3,
      engagement_time_msec: 1,
    });
  });

  it("does not send a redundant session_id param (M0.1 live-GA4 NAME_DUPLICATED finding, 2026-08-24)", () => {
    const payload = buildMpPayload({
      clientId: "cid",
      events: [{ event_id: "e1", name: "page_view", params: {} }],
      sessionId: "sess1",
      sessionNumber: 1,
    });
    expect(payload.events[0]?.params).not.toHaveProperty("session_id");
  });

  it("US-011: forwards the canonical @idhub anonymous id as idhub_anonymous_id without touching client_id", () => {
    const payload = buildMpPayload({
      clientId: "cid",
      events: [{ event_id: "e1", name: "page_view", params: {} }],
      sessionId: "sess1",
      sessionNumber: 1,
      anonymousId: "anon-123",
    });
    expect(payload.client_id).toBe("cid");
    expect(payload.events[0]?.params.idhub_anonymous_id).toBe("anon-123");
  });

  it("US-011: idhub_anonymous_id is undefined (and dropped by JSON.stringify) when no anonymous id is supplied", () => {
    const payload = buildMpPayload({
      clientId: "cid",
      events: [{ event_id: "e1", name: "page_view", params: {} }],
      sessionId: "sess1",
      sessionNumber: 1,
    });
    expect(payload.events[0]?.params.idhub_anonymous_id).toBeUndefined();
    expect(JSON.parse(JSON.stringify(payload)).events[0].params).not.toHaveProperty("idhub_anonymous_id");
  });
});
