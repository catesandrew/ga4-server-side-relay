import { describe, expect, it } from "vitest";
import { createServiceWorkerHandler } from "./create-service-worker-handler.js";

describe("createServiceWorkerHandler", () => {
  it("AC15: serves the script with Cache-Control: no-cache", async () => {
    const handler = createServiceWorkerHandler({ scope: "/", loadScriptSource: () => "// sw script" });
    const res = await handler();
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("content-type")).toBe("text/javascript");
    expect(await res.text()).toBe("// sw script");
  });

  it("AC27: includes Service-Worker-Allowed matching the configured scope", async () => {
    const handler = createServiceWorkerHandler({ scope: "/", loadScriptSource: () => "" });
    const res = await handler();
    expect(res.headers.get("service-worker-allowed")).toBe("/");
  });

  it("respects a narrower configured scope", async () => {
    const handler = createServiceWorkerHandler({ scope: "/analytics/", loadScriptSource: () => "" });
    const res = await handler();
    expect(res.headers.get("service-worker-allowed")).toBe("/analytics/");
  });

  it("loads the script lazily (only when the handler is invoked)", async () => {
    let loadCount = 0;
    const handler = createServiceWorkerHandler({
      scope: "/",
      loadScriptSource: () => {
        loadCount++;
        return "content";
      },
    });
    expect(loadCount).toBe(0);
    await handler();
    expect(loadCount).toBe(1);
  });
});
