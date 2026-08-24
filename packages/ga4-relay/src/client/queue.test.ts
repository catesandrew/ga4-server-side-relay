// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { enqueue, getAll, isExpired, MAX_QUEUE_SIZE, purgeAll, remove, scheduleRetry, type QueuedRecord } from "./queue.js";

function record(overrides: Partial<QueuedRecord> = {}): Omit<QueuedRecord, "id"> {
  return {
    schemaVersion: 1,
    event: { event_id: crypto.randomUUID(), name: "page_view", params: {} },
    capturedAt: Date.now(),
    identity: { client_id: "abc", ga_session_id: "s1", ga_session_number: 1, issued_at: Date.now(), signature: "sig" },
    capturedConsentGranted: true,
    ...overrides,
  };
}

describe("client queue.ts", () => {
  beforeEach(async () => {
    await purgeAll();
  });

  it("enqueues and reads back a record", async () => {
    await enqueue(record());
    const all = await getAll();
    expect(all).toHaveLength(1);
  });

  it("removes a record by id", async () => {
    await enqueue(record());
    const [first] = await getAll();
    await remove(first.id as number);
    expect(await getAll()).toHaveLength(0);
  });

  it("AC32: purgeAll empties the queue", async () => {
    await enqueue(record());
    await enqueue(record());
    await purgeAll();
    expect(await getAll()).toHaveLength(0);
  });

  it("is a bounded FIFO — drops the oldest record once MAX_QUEUE_SIZE is reached", async () => {
    for (let i = 0; i < MAX_QUEUE_SIZE; i++) {
      await enqueue(record({ event: { event_id: `e${i}`, name: "page_view", params: {} } }));
    }
    await enqueue(record({ event: { event_id: "overflow", name: "page_view", params: {} } }));
    const all = await getAll();
    expect(all).toHaveLength(MAX_QUEUE_SIZE);
    expect(all.some((r) => r.event.event_id === "e0")).toBe(false);
    expect(all.some((r) => r.event.event_id === "overflow")).toBe(true);
  });

  describe("scheduleRetry", () => {
    it("never schedules earlier than the server-requested retryAfterMs floor, even after jitter", async () => {
      // Jitter previously applied AFTER the floor was taken, so it could
      // pull the delay up to 25% below what the server asked for (codex
      // critic review round 2).
      await enqueue(record());
      const [stored] = await getAll();
      const now = 1_000_000_000;
      const retryAfterMs = 100_000;
      for (let trial = 0; trial < 20; trial++) {
        await scheduleRetry(stored, now, retryAfterMs);
        const [updated] = await getAll();
        expect(updated.nextAttemptAt! - now).toBeGreaterThanOrEqual(retryAfterMs);
      }
    });
  });

  describe("isExpired (AC13)", () => {
    it("is not expired within 48h", () => {
      const now = 1_000_000_000;
      expect(isExpired(record({ capturedAt: now }) as QueuedRecord, now + 47 * 60 * 60 * 1000)).toBe(false);
    });

    it("is expired past 48h", () => {
      const now = 1_000_000_000;
      expect(isExpired(record({ capturedAt: now }) as QueuedRecord, now + 49 * 60 * 60 * 1000)).toBe(true);
    });
  });
});
