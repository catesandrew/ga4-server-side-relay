import type { Store } from "./store.js";

const DEDUPE_TTL_MS = 48 * 60 * 60 * 1000;

/**
 * Dedupe check on client-generated event_id (plan step 2.1, AC9). Fails
 * CLOSED on Store unavailability: forwarding an unverifiable replay is
 * exactly the double-counting Principle 5 exists to prevent, so an
 * unreachable dedupe store must drop the event, never let it through.
 */
export async function checkAndMarkDedupe(
  store: Store,
  eventId: string,
): Promise<{ isDuplicate: boolean; storeUnavailable: boolean }> {
  try {
    const wasSet = await store.setNX(`dedupe:${eventId}`, "1", DEDUPE_TTL_MS);
    return { isDuplicate: !wasSet, storeUnavailable: false };
  } catch {
    return { isDuplicate: true, storeUnavailable: true };
  }
}

/**
 * Releases a dedupe reservation set by checkAndMarkDedupe. Required
 * because the mark happens BEFORE the deferred MP delivery (inside
 * `after()`) — if that delivery attempt actually fails (network error
 * reaching Google, not just a rejected response, which MP doesn't produce
 * per the docs), the event was never really delivered, but without this
 * release the client's own retry would be permanently deduped and the
 * event silently lost forever despite the response already having said
 * `200` (codex critic review round 4, reproduced live). Best-effort: a
 * failure here just means the reservation outlives its 48h TTL instead of
 * being released early — worse case is a legitimate retry gets deduped
 * once more within that window, not permanent loss.
 */
export async function releaseDedupe(store: Store, eventId: string): Promise<void> {
  try {
    await store.del(`dedupe:${eventId}`);
  } catch {
    // best-effort — see doc comment above
  }
}
