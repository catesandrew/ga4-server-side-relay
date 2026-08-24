import type { RelayConfig } from "./config.js";
import { DEFAULT_RATE_LIMIT } from "./config.js";
import {
  CLIENT_ID_COOKIE,
  SESSION_COOKIE,
  buildClientIdCookie,
  buildClientIdDeletionCookie,
  buildSessionCookie,
  buildSessionDeletionCookie,
  resolveClientId,
  resolveSession,
} from "./cookies.js";
import { isDenied, isWithdrawal } from "./consent.js";
import { extractClientIp, emptyResponse, jsonResponse, parseCookies, serializeSetCookie } from "./http.js";
import { buildMpPayload, sendToMp } from "./mp-client.js";
import { checkRateLimit } from "./store.js";
import { checkAndMarkDedupe, releaseDedupe } from "./dedupe-store.js";
import { TOKEN_COOKIE_NAME, signCaptureIdentity, verifyReplayIdentity, verifyToken } from "./token.js";
import { GA4_TOKEN_HEADER } from "./with-token-middleware.js";
import { exceedsBodySize, isValidCollectBody, splitIntoBatches, validateEvent } from "./validate.js";
import { recordTelemetry } from "./telemetry.js";
import type { CollectRequestBody } from "../shared/event.js";

/** Recommended `export const maxDuration` for the installer's route file — not the 300s default. */
export const RECOMMENDED_MAX_DURATION = 10;

export interface CollectHandlerDeps {
  /**
   * Wraps the MP-forward work. Defaults to Next.js `next/server`'s
   * `after()` when available; tests inject an immediate-await version so
   * assertions can run without a live Next.js request scope.
   */
  runAfterResponse?: (cb: () => Promise<void>) => void;
}

function defaultRunAfterResponse(cb: () => Promise<void>): void {
  // Fire-and-forget by default outside a Next.js request scope (e.g. tests).
  // Real installations pass `next/server`'s `after()` via deps.
  void cb();
}

export function createCollectHandler(config: RelayConfig, deps: CollectHandlerDeps = {}) {
  const runAfterResponse = deps.runAfterResponse ?? defaultRunAfterResponse;
  const rateLimit = config.rateLimit ?? DEFAULT_RATE_LIMIT;

  return async function handler(req: Request): Promise<Response> {
    const origin = req.headers.get("origin") ?? "";
    if (!config.allowedOrigins.includes(origin)) {
      recordTelemetry({ type: "dropped-permanent", reason: "origin-not-allowed" });
      return jsonResponse({ retryable: false, reason: "origin-not-allowed" }, { status: 403 });
    }

    const cookies = parseCookies(req.headers.get("cookie"));
    // Prefer the header withGa4Token forwards on THIS request — a cookie
    // set via middleware's Set-Cookie is only visible to the browser's
    // *next* request, not this one, so a clean browser's first request
    // would otherwise always 401 (found by codex critic review, reproduced
    // against the built demo). Falling back to the cookie still supports
    // callers that only ever set it there (e.g. a manually-crafted request).
    const tokenValue = req.headers.get(GA4_TOKEN_HEADER) ?? cookies[TOKEN_COOKIE_NAME];
    const tokenVerification = await verifyToken(tokenValue, config.tokenSecret);
    if (!tokenVerification.valid) {
      return jsonResponse({ retryable: "needs-token-refresh" }, { status: 401 });
    }
    // Origin binding actually enforced: a token minted for one origin must
    // not authorize requests claiming a different one (the token carries an
    // origin claim specifically so this check has something to verify).
    if (tokenVerification.payload!.origin !== origin) {
      return jsonResponse({ retryable: "needs-token-refresh" }, { status: 401 });
    }
    const kid = tokenVerification.payload!.kid;

    if (config.enabled === false) {
      return jsonResponse({ enabled: false }, { status: 200 });
    }

    const rawBody = await req.text();
    if (exceedsBodySize(Buffer.byteLength(rawBody, "utf8"))) {
      return jsonResponse({ retryable: false, reason: "body-too-large" }, { status: 400 });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return jsonResponse({ retryable: false, reason: "malformed-json" }, { status: 400 });
    }
    if (!isValidCollectBody(parsed)) {
      return jsonResponse({ retryable: false, reason: "malformed-body" }, { status: 400 });
    }
    const body: CollectRequestBody = parsed;

    const hasExistingIdentityCookie = Boolean(cookies[CLIENT_ID_COOKIE]);

    // AC6/AC6a/AC31: consent short-circuit runs before any identity is
    // computed. Only an explicit denial + existing cookie triggers deletion.
    if (isDenied(body.consent)) {
      recordTelemetry({ type: "consent-denied" });
      if (isWithdrawal(body.consent, hasExistingIdentityCookie)) {
        const deletionCookies = [
          serializeSetCookie(buildClientIdDeletionCookie({ cookieDomain: config.cookieDomain })),
          serializeSetCookie(buildSessionDeletionCookie({ cookieDomain: config.cookieDomain })),
        ];
        return emptyResponse(204, deletionCookies);
      }
      return emptyResponse(204);
    }

    const rateLimitResult = await checkRateLimit(config.store, kid, rateLimit.limit, rateLimit.windowMs);
    if (!rateLimitResult.allowed) {
      recordTelemetry({ type: "rate-limited", key: kid });
      return jsonResponse(
        { retryable: true, retryAfterMs: rateLimitResult.retryAfterMs },
        { status: 429 },
      );
    }

    const resolvedClientId = resolveClientId({
      existingCookie: cookies[CLIENT_ID_COOKIE],
      gaCookie: cookies["_ga"],
    });

    // Replay path (AC22/AC24): a queued offline event flushed later. The
    // signature must verify AND the signed client_id must match the live
    // cookie — the signature alone only authorizes session continuity,
    // never an identity override (closes the exfiltration/stitching hole).
    let sessionId: string;
    let sessionNumber: number;
    let isReplay = false;
    let capturedAtMs: number | undefined;
    if (body.replay) {
      const verdict = await verifyReplayIdentity(body.replay, resolvedClientId.raw, config.tokenSecret);
      if (!verdict.ok) {
        return jsonResponse({ retryable: false, reason: verdict.reason }, { status: 400 });
      }
      sessionId = body.replay.ga_session_id;
      sessionNumber = body.replay.ga_session_number;
      isReplay = true;
      // AC6b/AC12: MP must see the EVENT's capture time, not flush time —
      // and not the identity's issue time either, since one cached
      // identity is reused across many events with different capture
      // times (a prior version used replay.issued_at here, which is only
      // right for the very first event sent under that identity — codex
      // critic review round 2, reproduced live). capturedAtMs is
      // client-asserted like any analytics timestamp; bounded here rather
      // than trusted outright. Snapshot `now` once so the two comparisons
      // can't straddle a race, and require strictly non-future — a prior
      // 5-minute future grace contradicted the stated "not future" bound
      // and forwarded a genuinely future timestamp_micros to MP (codex
      // critic review round 3, reproduced live). Falls back to the
      // identity's issue time if absent or out of bounds.
      const requestReceivedAt = Date.now();
      const clientClaimed = body.capturedAtMs;
      const withinBounds =
        typeof clientClaimed === "number" &&
        clientClaimed <= requestReceivedAt &&
        requestReceivedAt - clientClaimed <= 48 * 60 * 60 * 1000;
      capturedAtMs = withinBounds ? clientClaimed : body.replay.issued_at;
    } else {
      const session = resolveSession(cookies[SESSION_COOKIE]);
      sessionId = session.ga_session_id;
      sessionNumber = session.ga_session_number;
    }

    const validEvents = [];
    for (const rawEvent of body.events) {
      const result = validateEvent(rawEvent, { blockedParamNames: config.blockedParamNames });
      if (!result.valid) {
        recordTelemetry({ type: "dropped-permanent", reason: result.reason });
        continue;
      }
      const dedupe = await checkAndMarkDedupe(config.store, result.event.event_id);
      // Fail-closed applies to REPLAYS only (2.1's stated policy): losing an
      // already-attempted queued event to a store hiccup is the safe side.
      // A fresh LIVE event has never been sent before — silently dropping it
      // on a store outage while still returning 200 would be undetectable
      // data loss, which is worse than the small risk of an undetected
      // duplicate, so live events fail OPEN (forwarded) on store errors.
      const treatAsDuplicate = dedupe.storeUnavailable ? isReplay : dedupe.isDuplicate;
      if (treatAsDuplicate) {
        recordTelemetry({ type: "deduped" });
        continue;
      }
      validEvents.push(result.event);
    }

    const ipOverride = extractClientIp(req.headers);
    const userAgent = req.headers.get("user-agent") ?? undefined;
    const batches = splitIntoBatches(validEvents);

    runAfterResponse(async () => {
      for (const batch of batches) {
        const payload = buildMpPayload({
          clientId: resolvedClientId.raw,
          events: batch,
          sessionId,
          sessionNumber,
          ipOverride,
          consent: body.consent,
          capturedAtMs,
        });
        try {
          await sendToMp(payload, config, { userAgent });
          recordTelemetry({ type: "forwarded", count: batch.length });
        } catch {
          // The dedupe mark for these events was already set above, BEFORE
          // this deferred send — if the send itself never reached MP (a
          // network-level failure, not an MP rejection, which the docs say
          // never happens), the events were never really delivered despite
          // the response already having said 200. Releasing the mark lets
          // the client's own retry succeed instead of being silently
          // deduped forever (codex critic review round 4, reproduced
          // live). A truly concurrent retry landing in the gap between
          // release and the client's next attempt could double-send —
          // accepted as the lesser failure mode vs. permanent silent loss.
          for (const event of batch) {
            await releaseDedupe(config.store, event.event_id);
          }
        }
      }
    });

    if (isReplay) {
      return emptyResponse(204);
    }

    const setCookies = [
      serializeSetCookie(buildClientIdCookie(resolvedClientId.cookieValue, { cookieDomain: config.cookieDomain })),
      serializeSetCookie(
        buildSessionCookie({ ga_session_id: sessionId, ga_session_number: sessionNumber, lastSeen: Date.now() }, {
          cookieDomain: config.cookieDomain,
        }),
      ),
    ];

    const identity = await signCaptureIdentity(
      { client_id: resolvedClientId.raw, ga_session_id: sessionId, ga_session_number: sessionNumber },
      config.tokenSecret,
    );

    const headers = new Headers({ "content-type": "application/json" });
    for (const cookie of setCookies) headers.append("set-cookie", cookie);
    return new Response(JSON.stringify(identity), { status: 200, headers });
  };
}
