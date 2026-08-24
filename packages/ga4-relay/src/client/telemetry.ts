/**
 * Client-side counterpart to server/telemetry.ts — retries happen entirely
 * client-side (the flush queue), so a server-only telemetry module could
 * never actually emit a "retried" event; this module can't import
 * server/telemetry.ts anyway (the client/server entrypoint boundary, plan
 * step 1.13, forbids it). `console.debug` keeps this greppable in the
 * browser console without adding a network dependency for a client that
 * may itself be offline.
 */
export type ClientTelemetryEvent = { type: "retried" } | { type: "dropped-permanent"; reason: string };

export function recordClientTelemetry(event: ClientTelemetryEvent): void {
  console.debug(JSON.stringify({ ga4_relay_client_telemetry: true, ts: Date.now(), ...event }));
}
