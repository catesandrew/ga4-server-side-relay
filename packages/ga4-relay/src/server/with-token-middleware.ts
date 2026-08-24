import type { RelayConfig } from "./config.js";
import { parseCookies } from "./http.js";
import { TOKEN_COOKIE_NAME, reissueTokenIfNeeded } from "./token.js";
import type { CookieDescriptor } from "./cookies.js";

const TOKEN_MAX_AGE_SECONDS = 15 * 60;

/**
 * Deliberately narrow: withGa4Token needs only tokenSecret/cookieDomain,
 * not the full RelayConfig (measurementId, apiSecret, store, etc). Next.js
 * middleware.ts runs on the Edge runtime only — if an installer built this
 * from the same config object used to construct createGa4Relay() for
 * their route handlers, the whole server surface (Upstash client, Node
 * Buffer usage, etc.) would get pulled into the Edge middleware bundle and
 * break at runtime. Keeping this config shape minimal keeps that from
 * happening structurally, not just by convention.
 */
export type WithGa4TokenConfig = Pick<RelayConfig, "tokenSecret" | "cookieDomain">;

/**
 * Header the collect handler reads the token from on the SAME request that
 * middleware minted it on. A cookie set via `Set-Cookie` on the middleware's
 * response is only visible to the BROWSER on its *next* request — Next.js
 * middleware and the route handler it forwards to still see the ORIGINAL
 * incoming request, so a route handler reading only the cookie would see no
 * token at all on a clean browser's first request and 401 forever (found by
 * codex critic review, reproduced against the built demo). Forwarding the
 * token via a request header — which the installer's middleware attaches to
 * the request Next.js continues with — closes that gap; the Set-Cookie is
 * still set for the browser to send back on subsequent requests, but the
 * collect handler no longer depends on that round trip having happened yet.
 */
export const GA4_TOKEN_HEADER = "x-ga4-relay-token";

export interface ResolvedGa4Token {
  token: string;
  /** Set on the response so the browser persists the token across requests. */
  cookie: CookieDescriptor;
}

/**
 * Composable middleware helper (plan step 1.5). A Next.js app can only
 * have one root middleware.ts, so this package cannot ship its own file —
 * the installer imports `withGa4Token(config)`, calls it from their own
 * middleware to resolve the current token, forwards it to the route handler
 * via a request header (`NextResponse.next({ request: { headers } })`), and
 * sets the returned cookie on the response for the browser. See
 * apps/demo/middleware.ts for the reference wiring. Recommended matcher:
 * scope this to the collect/debug/SW routes only, so it doesn't add Edge
 * latency to every request in the host app.
 */
export function withGa4Token(config: WithGa4TokenConfig) {
  return async function resolveGa4Token(request: Request): Promise<ResolvedGa4Token> {
    const cookies = parseCookies(request.headers.get("cookie"));
    const origin = request.headers.get("origin") ?? new URL(request.url).origin;
    const { token } = await reissueTokenIfNeeded(cookies[TOKEN_COOKIE_NAME], origin, config.tokenSecret);
    const cookie: CookieDescriptor = {
      name: TOKEN_COOKIE_NAME,
      value: token,
      maxAge: TOKEN_MAX_AGE_SECONDS,
      domain: config.cookieDomain,
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "lax",
    };
    return { token, cookie };
  };
}
