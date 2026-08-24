import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDebugHandler } from "./create-debug-handler.js";
import { InMemoryStore } from "./store.js";
import { startMockMpServer, type MockMpServer } from "../../test/mock-mp-server.js";

describe("createDebugHandler (AC1)", () => {
  let mockServer: MockMpServer;

  beforeEach(async () => {
    mockServer = await startMockMpServer({ validationMessages: [] });
  });

  afterEach(async () => {
    await mockServer.close();
  });

  it("round-trips a payload to /debug/mp/collect and returns its validationMessages", async () => {
    const handler = createDebugHandler({
      measurementId: "G-TEST",
      apiSecret: "secret",
      tokenSecret: "token-secret",
      allowedOrigins: [],
      store: new InMemoryStore(),
      endpointBaseOverride: mockServer.url,
    });
    const req = new Request("https://relay.example.com/debug", {
      method: "POST",
      body: JSON.stringify({ events: [{ event_id: "1", name: "page_view", params: {} }] }),
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.validationMessages).toEqual([]);
    expect(mockServer.debugRequests).toHaveLength(1);
  });
});
