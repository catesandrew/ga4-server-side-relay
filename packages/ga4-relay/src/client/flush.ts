import { getAll, isExpired, remove, scheduleRetry } from "./queue.js";
import { resolveConsent } from "./consent-bridge.js";
import { classifyCollectResponse } from "./classify-response.js";
import { recordClientTelemetry } from "./telemetry.js";
import type { CollectRequestBody } from "../shared/event.js";

export interface FlushOptions {
  collectUrl: string;
  /** True when running from a page-load context (token refresh is possible there); false from a Background-Sync-only SW context. */
  canRefreshToken: boolean;
}

/**
 * AC26 (three-class retry classification): 400/403 drop permanently.
 * 401 ("needs-token-refresh") stays queued and is only retried from a
 * page-load context — a Background-Sync-only flush has no way to refresh
 * an expired ~15min token, so treating 401 as permanent there would
 * silently delete the highest-value offline-captured events.
 * 429/5xx/network retry with backoff from any context.
 */
export async function flushQueue(options: FlushOptions): Promise<void> {
  const records = await getAll();
  if (records.length === 0) return;

  // AC33: current consent at flush time is resolved ONCE per pass — both
  // for the denial gate below and for every record's POST body, so the two
  // can never disagree (see resolveConsent's doc comment for the bug this
  // fixes). If denied, every queued record is DROPPED here, not merely
  // skipped-and-left-queued — a prior version left denied records sitting
  // in the queue forever, which is not what "dropped" means.
  const resolvedConsent = await resolveConsent();
  if (!resolvedConsent || resolvedConsent.analytics_storage !== "granted") {
    for (const record of records) {
      if (record.id !== undefined) await remove(record.id);
    }
    return;
  }

  const now = Date.now();
  for (const record of records) {
    if (record.id === undefined) continue;

    if (isExpired(record, now)) {
      await remove(record.id); // AC13
      continue;
    }

    if (record.nextAttemptAt !== undefined && record.nextAttemptAt > now) {
      continue; // backoff window not elapsed yet
    }

    const body: CollectRequestBody = {
      events: [record.event],
      // Realm-agnostic — resolveConsent() (whose result also gates whether
      // to even attempt this pass, above) reads persisted consent when
      // globalThis isn't populated (e.g. inside the SW); the POST body
      // must carry that SAME resolved value, not a separate synchronous
      // globalThis-only read that's always undefined in that realm
      // (codex critic review round 2, reproduced live).
      consent: resolvedConsent,
      replay: record.identity,
      // The event's actual capture time, not the (possibly much earlier
      // or later, since one identity is reused across many events)
      // identity-issuance time in replay.issued_at.
      capturedAtMs: record.capturedAt,
    };

    let response: Response;
    try {
      response = await fetch(options.collectUrl, { method: "POST", body: JSON.stringify(body) });
    } catch {
      recordClientTelemetry({ type: "retried" });
      await scheduleRetry(record, now); // network/offline: stays queued, backs off
      continue;
    }

    const classified = await classifyCollectResponse(response);
    switch (classified.outcome) {
      case "success":
        await remove(record.id);
        break;
      case "permanent":
        recordClientTelemetry({ type: "dropped-permanent", reason: "server-rejected" });
        await remove(record.id);
        break;
      case "needs-token-refresh":
        if (options.canRefreshToken) {
          // A page-load context reissues the token via withGa4Token
          // middleware before this flush runs again on the next attempt.
          recordClientTelemetry({ type: "retried" });
          await scheduleRetry(record, now);
        }
        // else: stays queued as-is, never retried from a Background-Sync-only context.
        break;
      case "retry":
        recordClientTelemetry({ type: "retried" });
        await scheduleRetry(record, now, classified.retryAfterMs);
        break;
    }
  }
}
