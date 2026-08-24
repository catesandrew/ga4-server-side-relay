import type { RelayConfig } from "./config.js";
import { jsonResponse } from "./http.js";
import { buildMpPayload, validateWithMp } from "./mp-client.js";
import type { CollectRequestBody } from "../shared/event.js";

/** Factory for a passthrough to MP's validation endpoint (plan step 1.8). */
export function createDebugHandler(config: RelayConfig) {
  return async function handler(req: Request): Promise<Response> {
    const body = (await req.json()) as CollectRequestBody;
    const payload = buildMpPayload({
      clientId: "debug-client-id",
      events: body.events,
      sessionId: "debug-session-id",
      sessionNumber: 1,
    });
    const result = await validateWithMp(payload, config);
    return jsonResponse(result, { status: 200 });
  };
}
