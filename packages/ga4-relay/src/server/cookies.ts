import { newId } from "./hmac.js";

export const CLIENT_ID_COOKIE = "__ga4r_cid";
export const SESSION_COOKIE = "__ga4r_sess";
const COOKIE_VERSION_PREFIX = "v1:";
const CLIENT_ID_MAX_AGE_SECONDS = 63072000; // 2 years
const SESSION_WINDOW_MS = 30 * 60 * 1000;

export interface CookieDescriptor {
  name: string;
  value: string;
  maxAge?: number; // seconds; 0 means delete
  domain?: string;
  path: string;
  secure: true;
  httpOnly: true;
  sameSite: "lax";
}

function baseCookie(config: { cookieDomain?: string }): Pick<
  CookieDescriptor,
  "domain" | "path" | "secure" | "httpOnly" | "sameSite"
> {
  return {
    domain: config.cookieDomain,
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "lax",
  };
}

/** Wraps a raw client_id in the storage-only version prefix. */
export function wrapClientId(raw: string): string {
  return `${COOKIE_VERSION_PREFIX}${raw}`;
}

/**
 * Strips the storage-only v1: prefix before the value is used in any
 * outbound MP payload or identity JSON response (Critic round-3 minor #8)
 * — otherwise MP would receive "v1:<random>.<timestamp>" and AC3's join
 * with gtag-collected data would silently fail.
 */
export function unwrapClientId(cookieValue: string): string {
  return cookieValue.startsWith(COOKIE_VERSION_PREFIX)
    ? cookieValue.slice(COOKIE_VERSION_PREFIX.length)
    : cookieValue;
}

/** Extracts the <random>.<timestamp> portion of an existing _ga cookie (AC3). */
export function parseGaCookie(gaCookieValue: string | undefined): string | null {
  if (!gaCookieValue) return null;
  // Format: GA<version>.<n>.<random>.<timestamp>
  const parts = gaCookieValue.split(".");
  if (parts.length < 4) return null;
  const [, , random, timestamp] = parts;
  if (!random || !timestamp) return null;
  return `${random}.${timestamp}`;
}

export interface ResolvedClientId {
  raw: string;
  cookieValue: string;
  isNew: boolean;
}

/** AC2/AC3: reuse the wrapped cookie if present, else derive from _ga, else mint a UUID. */
export function resolveClientId(params: {
  existingCookie: string | undefined;
  gaCookie: string | undefined;
}): ResolvedClientId {
  if (params.existingCookie) {
    return { raw: unwrapClientId(params.existingCookie), cookieValue: params.existingCookie, isNew: false };
  }
  const fromGa = parseGaCookie(params.gaCookie);
  const raw = fromGa ?? newId();
  return { raw, cookieValue: wrapClientId(raw), isNew: true };
}

export function buildClientIdCookie(cookieValue: string, config: { cookieDomain?: string }): CookieDescriptor {
  return {
    name: CLIENT_ID_COOKIE,
    value: cookieValue,
    maxAge: CLIENT_ID_MAX_AGE_SECONDS,
    ...baseCookie(config),
  };
}

/** AC31: deletion header must mirror the exact Domain/Path used at set-time. */
export function buildClientIdDeletionCookie(config: { cookieDomain?: string }): CookieDescriptor {
  return { name: CLIENT_ID_COOKIE, value: "", maxAge: 0, ...baseCookie(config) };
}

export interface SessionState {
  ga_session_id: string;
  ga_session_number: number;
  lastSeen: number;
}

function serializeSession(state: SessionState): string {
  return `${state.ga_session_id}:${state.ga_session_number}:${state.lastSeen}`;
}

function parseSession(raw: string | undefined): SessionState | null {
  if (!raw) return null;
  const [id, num, lastSeen] = raw.split(":");
  if (!id || !num || !lastSeen) return null;
  const ga_session_number = Number(num);
  const lastSeenNum = Number(lastSeen);
  if (Number.isNaN(ga_session_number) || Number.isNaN(lastSeenNum)) return null;
  return { ga_session_id: id, ga_session_number, lastSeen: lastSeenNum };
}

/**
 * AC4: 30-min sliding session window; new session increments ga_session_number.
 * `ga_session_id` must be a numeric string (GA4 MP validates it against
 * `^\d+$`) — a UUID here was rejected by real GA4 despite passing this
 * package's own mock-server tests (codex critic review). Matches gtag.js's
 * own convention: the session's start time in epoch seconds.
 */
export function resolveSession(existingCookie: string | undefined, now = Date.now()): SessionState {
  const parsed = parseSession(existingCookie);
  if (parsed && now - parsed.lastSeen <= SESSION_WINDOW_MS) {
    return { ...parsed, lastSeen: now };
  }
  const priorNumber = parsed?.ga_session_number ?? 0;
  return { ga_session_id: String(Math.floor(now / 1000)), ga_session_number: priorNumber + 1, lastSeen: now };
}

export function buildSessionCookie(state: SessionState, config: { cookieDomain?: string }): CookieDescriptor {
  return {
    name: SESSION_COOKIE,
    value: serializeSession(state),
    maxAge: Math.floor(SESSION_WINDOW_MS / 1000),
    ...baseCookie(config),
  };
}

export function buildSessionDeletionCookie(config: { cookieDomain?: string }): CookieDescriptor {
  return { name: SESSION_COOKIE, value: "", maxAge: 0, ...baseCookie(config) };
}
