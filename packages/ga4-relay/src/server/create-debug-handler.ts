import type { RelayConfig } from "./config.js";
import { CLIENT_ID_COOKIE, SESSION_COOKIE, resolveClientId, resolveSession } from "./cookies.js";
import { jsonResponse, parseCookies } from "./http.js";
import { buildMpPayload, validateWithMp } from "./mp-client.js";
import type { CollectRequestBody } from "../shared/event.js";
import { getAnonymousIdFromHeaders } from "@idhub/identity-core";

/**
 * Factory for a passthrough to MP's validation endpoint (plan step 1.8).
 * Read-only by design: resolves the live client_id/session/idhub anonymous
 * id purely to report them in the validated payload — it never mints or
 * writes a Set-Cookie, so debugging a payload can't itself alter the
 * identity a real /collect request would see.
 */
export function createDebugHandler(config: RelayConfig) {
  return async function handler(req: Request): Promise<Response> {
    const body = (await req.json()) as CollectRequestBody;
    const cookies = parseCookies(req.headers.get("cookie"));
    const resolvedClientId = resolveClientId({
      existingCookie: cookies[CLIENT_ID_COOKIE],
      gaCookie: cookies["_ga"],
    });
    const session = resolveSession(cookies[SESSION_COOKIE]);
    const anonymousId = getAnonymousIdFromHeaders(req.headers, { domain: config.cookieDomain });
    const payload = buildMpPayload({
      clientId: resolvedClientId.raw,
      events: body.events,
      sessionId: session.ga_session_id,
      sessionNumber: session.ga_session_number,
      anonymousId,
    });
    const result = await validateWithMp(payload, config);
    return jsonResponse(result, { status: 200 });
  };
}
