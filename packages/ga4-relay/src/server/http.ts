import type { CookieDescriptor } from "./cookies.js";

export function parseCookies(cookieHeader: string | null): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const pair of cookieHeader.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!key) continue;
    // A malformed percent-encoding (e.g. a bare "%" from a corrupted or
    // adversarial Cookie header) throws URIError — uncaught, that took
    // down the whole request with a framework-level 500 before even
    // reaching the origin/token checks (codex critic review round 4,
    // reproduced live). Skip just that one malformed cookie pair instead.
    try {
      result[key] = decodeURIComponent(value);
    } catch {
      continue;
    }
  }
  return result;
}

export function serializeSetCookie(cookie: CookieDescriptor): string {
  const parts = [`${cookie.name}=${encodeURIComponent(cookie.value)}`];
  parts.push(`Path=${cookie.path}`);
  if (cookie.domain) parts.push(`Domain=${cookie.domain}`);
  if (cookie.maxAge !== undefined) parts.push(`Max-Age=${cookie.maxAge}`);
  if (cookie.secure) parts.push("Secure");
  if (cookie.httpOnly) parts.push("HttpOnly");
  if (cookie.sameSite) parts.push(`SameSite=${cookie.sameSite[0].toUpperCase()}${cookie.sameSite.slice(1)}`);
  return parts.join("; ");
}

/**
 * AC5: sources ip_override from the platform-set x-vercel-forwarded-for
 * header exclusively — the client-supplied x-forwarded-for is spoofable
 * and must never feed this value.
 */
export function extractClientIp(headers: Headers): string | undefined {
  const platformHeader = headers.get("x-vercel-forwarded-for");
  if (!platformHeader) return undefined;
  return platformHeader.split(",")[0]?.trim();
}

export function jsonResponse(
  body: unknown,
  init: { status: number; headers?: Record<string, string> } = { status: 200 },
): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status: init.status,
    headers,
  });
}

export function emptyResponse(
  status: number,
  setCookies: string[] = [],
  extraHeaders: Record<string, string> = {},
): Response {
  const headers = new Headers(extraHeaders);
  for (const cookie of setCookies) headers.append("set-cookie", cookie);
  return new Response(null, { status, headers });
}
