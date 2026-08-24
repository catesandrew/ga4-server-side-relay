export type CollectResponseClass = "success" | "permanent" | "retry" | "needs-token-refresh";

interface CollectErrorBody {
  retryable?: false | true | "needs-token-refresh";
  retryAfterMs?: number;
}

export interface ClassifiedResponse {
  outcome: CollectResponseClass;
  retryAfterMs?: number;
}

/**
 * Shared response classification (AC26's three classes) so the live-send
 * fallback path (client-sdk.ts) and the queued-replay flush path
 * (flush.ts) can't silently diverge on what counts as permanent vs
 * retryable — a prior version only checked this in flush.ts, so a fresh
 * event's fetch-fallback ignored non-2xx responses entirely and just
 * dropped the event on the floor (codex critic review).
 */
export async function classifyCollectResponse(response: Response): Promise<ClassifiedResponse> {
  if (response.status === 204 || response.ok) return { outcome: "success" };
  let body: CollectErrorBody | undefined;
  try {
    body = (await response.json()) as CollectErrorBody;
  } catch {
    return { outcome: "retry" }; // no parseable body: treat like a 5xx/network-shaped failure
  }
  if (body.retryable === false) return { outcome: "permanent" };
  if (body.retryable === "needs-token-refresh") return { outcome: "needs-token-refresh" };
  return { outcome: "retry", retryAfterMs: body.retryAfterMs };
}
