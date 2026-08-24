import { describe, expect, it } from "vitest";
import { checkAndMarkDedupe, releaseDedupe } from "./dedupe-store.js";
import { InMemoryStore } from "./store.js";

describe("dedupe-store.ts", () => {
  it("AC9: the same event_id posted twice is flagged as a duplicate the second time", async () => {
    const store = new InMemoryStore();
    const first = await checkAndMarkDedupe(store, "event-1");
    expect(first.isDuplicate).toBe(false);
    const second = await checkAndMarkDedupe(store, "event-1");
    expect(second.isDuplicate).toBe(true);
  });

  it("fails closed (treated as a duplicate) when the Store is unreachable", async () => {
    const throwingStore = {
      async incr(): Promise<number> {
        throw new Error("unreachable");
      },
      async get() {
        return null;
      },
      async setNX(): Promise<boolean> {
        throw new Error("unreachable");
      },
      async del(): Promise<void> {
        throw new Error("unreachable");
      },
    };
    const result = await checkAndMarkDedupe(throwingStore, "event-1");
    expect(result.isDuplicate).toBe(true);
    expect(result.storeUnavailable).toBe(true);
  });

  it("releaseDedupe lets a released event_id be marked again (retry after a failed delivery)", async () => {
    const store = new InMemoryStore();
    await checkAndMarkDedupe(store, "event-1");
    await releaseDedupe(store, "event-1");
    const afterRelease = await checkAndMarkDedupe(store, "event-1");
    expect(afterRelease.isDuplicate).toBe(false);
  });

  it("releaseDedupe never throws even when the Store is unreachable (best-effort)", async () => {
    const throwingStore = {
      async incr(): Promise<number> {
        return 1;
      },
      async get() {
        return null;
      },
      async setNX(): Promise<boolean> {
        return true;
      },
      async del(): Promise<void> {
        throw new Error("unreachable");
      },
    };
    await expect(releaseDedupe(throwingStore, "event-1")).resolves.toBeUndefined();
  });
});
