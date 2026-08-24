/**
 * Structured counters (plan step 1.11). "Counters" on stateless Vercel
 * means log lines + external aggregation, not in-process state — each
 * distinct counter must be independently greppable so a spike in
 * "dropped" is distinguishable from a spike in "forwarded".
 */
export type TelemetryEvent =
  | { type: "forwarded"; count: number }
  | { type: "dropped-permanent"; reason: string }
  | { type: "rate-limited"; key: string }
  | { type: "consent-denied" }
  | { type: "retried" }
  | { type: "deduped" };

export function recordTelemetry(event: TelemetryEvent): void {
  console.log(JSON.stringify({ ga4_relay_telemetry: true, ts: Date.now(), ...event }));
}
