import { describe, expect, it, vi } from "vitest";
import { recordTelemetry } from "./telemetry.js";

describe("telemetry.ts", () => {
  it("emits a structured, greppable log line per event type", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    recordTelemetry({ type: "forwarded", count: 3 });
    recordTelemetry({ type: "dropped-permanent", reason: "pii-detected" });
    recordTelemetry({ type: "rate-limited", key: "kid-1" });
    recordTelemetry({ type: "consent-denied" });
    recordTelemetry({ type: "retried" });
    recordTelemetry({ type: "deduped" });

    expect(spy).toHaveBeenCalledTimes(6);
    const parsed = spy.mock.calls.map(([line]) => JSON.parse(line as string));
    expect(parsed.map((p) => p.type)).toEqual([
      "forwarded",
      "dropped-permanent",
      "rate-limited",
      "consent-denied",
      "retried",
      "deduped",
    ]);
    expect(parsed.every((p) => p.ga4_relay_telemetry === true && typeof p.ts === "number")).toBe(true);
    spy.mockRestore();
  });
});
