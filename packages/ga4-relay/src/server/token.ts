import { newId, signPayload, verifySignature } from "./hmac.js";
import type { CaptureIdentity, SignedCaptureIdentity } from "../shared/event.js";

/**
 * Signed short-lived provenance token (plan step 1.5). Binds an origin +
 * a random per-issuance `kid` subject claim + a TTL. This is request
 * provenance, not visitor authentication — any client can obtain one by
 * loading the page first (see Requirements Summary).
 *
 * All signing/verification here is async (Web Crypto) and encode/decode
 * avoids Node's Buffer — this module is used by withGa4Token, which must
 * run inside Next.js middleware.ts (Edge runtime only).
 */
export interface TokenPayload {
  origin: string;
  kid: string;
  issuedAt: number;
  expiresAt: number;
}

const TOKEN_TTL_MS = 15 * 60 * 1000;
export const TOKEN_COOKIE_NAME = "__ga4r_tok";

function base64UrlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(encoded: string): string {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encode(payload: TokenPayload): string {
  return base64UrlEncode(JSON.stringify(payload));
}

function decode(raw: string): TokenPayload | null {
  try {
    return JSON.parse(base64UrlDecode(raw)) as TokenPayload;
  } catch {
    return null;
  }
}

export async function mintToken(origin: string, secret: string, now = Date.now()): Promise<string> {
  const payload: TokenPayload = {
    origin,
    kid: newId(),
    issuedAt: now,
    expiresAt: now + TOKEN_TTL_MS,
  };
  const body = encode(payload);
  const sig = await signPayload(body, secret);
  return `${body}.${sig}`;
}

export interface VerifiedToken {
  valid: boolean;
  payload: TokenPayload | null;
}

export async function verifyToken(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): Promise<VerifiedToken> {
  if (!token) return { valid: false, payload: null };
  const [body, sig] = token.split(".");
  if (!body || !sig) return { valid: false, payload: null };
  if (!(await verifySignature(body, sig, secret))) return { valid: false, payload: null };
  const payload = decode(body);
  if (!payload) return { valid: false, payload: null };
  if (payload.expiresAt < now) return { valid: false, payload: null };
  return { valid: true, payload };
}

/**
 * Reissue condition (Critic round-3 minor #6): mint a fresh token (new kid,
 * resetting any rate-limit counter keyed on it) only when the incoming
 * cookie has no valid, unexpired token FOR THIS ORIGIN. A request presenting
 * a still-valid same-origin token is passed through unchanged so its kid
 * persists for the token's full TTL — otherwise AC29's counter could never
 * accumulate. A valid token minted for a DIFFERENT origin must still trigger
 * reissue: without this check, an installer with multiple allowed origins
 * sharing one cookie domain would have the first origin's token reused for
 * the second, which the collect handler's origin-binding check then rejects
 * forever (codex critic review round 2 — reproduced live).
 */
export async function reissueTokenIfNeeded(
  existingCookie: string | undefined,
  origin: string,
  secret: string,
  now = Date.now(),
): Promise<{ token: string; reissued: boolean }> {
  const verified = await verifyToken(existingCookie, secret, now);
  if (verified.valid && verified.payload!.origin === origin) {
    return { token: existingCookie as string, reissued: false };
  }
  return { token: await mintToken(origin, secret, now), reissued: true };
}

const CAPTURE_IDENTITY_MAX_AGE_MS = 48 * 60 * 60 * 1000; // matches the 48h queue/dedupe TTL

/**
 * Signs a capture-time identity snapshot (client_id/ga_session_id/
 * ga_session_number + issued_at) so it can be safely returned to page JS
 * and later replayed from the offline queue (plan step 1.7, AC22/AC24).
 * The signature only ever authorizes restoring session continuity — the
 * replay verifier below additionally requires the client_id to match the
 * browser's live cookie before trusting anything from a replay.
 */
export async function signCaptureIdentity(
  identity: CaptureIdentity,
  secret: string,
  now = Date.now(),
): Promise<SignedCaptureIdentity> {
  const issued_at = now;
  const body = JSON.stringify({ ...identity, issued_at });
  const signature = await signPayload(body, secret);
  return { ...identity, issued_at, signature };
}

export type ReplayVerdict =
  | { ok: true }
  | { ok: false; reason: "invalid-signature" | "expired" | "client-id-mismatch" };

/**
 * Verifies a replayed capture-time identity against its signature, its
 * 48h staleness bound, and — critically — the live cookie's client_id.
 * The signature alone is not sufficient: without the live-cookie check an
 * exfiltrated snapshot (e.g. read from IndexedDB by a third-party script)
 * could be replayed to stitch sessions across users (Critic round-2 J1).
 */
export async function verifyReplayIdentity(
  replay: SignedCaptureIdentity,
  liveClientId: string,
  secret: string,
  now = Date.now(),
): Promise<ReplayVerdict> {
  const { signature, ...rest } = replay;
  const body = JSON.stringify(rest);
  if (!(await verifySignature(body, signature, secret))) {
    return { ok: false, reason: "invalid-signature" };
  }
  if (now - replay.issued_at > CAPTURE_IDENTITY_MAX_AGE_MS) {
    return { ok: false, reason: "expired" };
  }
  if (replay.client_id !== liveClientId) {
    return { ok: false, reason: "client-id-mismatch" };
  }
  return { ok: true };
}
