import { NextResponse, type NextRequest } from "next/server";
import { withGa4Token, GA4_TOKEN_HEADER, serializeSetCookie } from "@gtmss/ga4-relay/server";

// Deliberately does NOT import ./lib/relay.ts — that module constructs the
// full createGa4Relay() object (store, mp-client, etc.), and Next.js
// middleware.ts runs on the Edge runtime only. Importing the shared relay
// singleton here would pull the whole server module graph into the Edge
// bundle. withGa4Token's config is intentionally narrow (tokenSecret +
// cookieDomain only) so this stays a small, Edge-safe import.
const resolveToken = withGa4Token({
  tokenSecret: process.env.GA4_TOKEN_SECRET ?? "",
  cookieDomain: process.env.GA4_COOKIE_DOMAIN,
});

export async function middleware(request: NextRequest) {
  const { token, cookie } = await resolveToken(request);

  // Forward the token via a request header so the ROUTE HANDLER sees it on
  // THIS same request — a cookie set only via Set-Cookie below is visible
  // to the browser's *next* request, not this one, so a clean browser's
  // first request would otherwise 401 forever (codex critic review,
  // reproduced against this exact build before this fix).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(GA4_TOKEN_HEADER, token);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.append("set-cookie", serializeSetCookie(cookie));
  return response;
}

// Recommended scope (plan step 1.5): only the collect/debug/SW routes, so
// this middleware doesn't add Edge latency to every request in the host app.
export const config = {
  matcher: ["/api/ga4/:path*", "/ga4-relay/:path*"],
};
