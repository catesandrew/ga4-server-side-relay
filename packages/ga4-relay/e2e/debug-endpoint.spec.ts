import { test, expect } from "@playwright/test";
import { DEFAULT_ANONYMOUS_ID_COOKIE_NAME } from "@idhub/identity-core";
import { CLIENT_ID_COOKIE, SESSION_COOKIE } from "../src/server/cookies";
import { HomePage } from "./page-objects/HomePage";
import { unregisterAllServiceWorkers } from "./helpers";
import { waitForCookieValue } from "./wait/readiness";

const DEBUG_EVENT_BODY = {
  events: [{ event_id: "debug-endpoint-spec-probe", name: "debug_endpoint_spec_probe", params: {} }],
};

// Covers apps/demo/app/api/ga4/debug/route.ts (packages/ga4-relay/src/server/
// create-debug-handler.ts): the debug passthrough now resolves the SAME live
// client_id/session/idhub identity a real /collect request would see, from
// the browser's real cookies, instead of the previous hardcoded
// "debug-client-id"/"debug-session-id" placeholders — and, per the
// handler's own read-only-by-design contract, must do so without ever
// minting or rewriting any of them.
test.describe("Debug endpoint — real identity passthrough", () => {
  test.afterEach(async ({ page }) => {
    await unregisterAllServiceWorkers(page).catch(() => undefined);
  });

  test("resolves the browser's live identity cookies without minting or rewriting any of them", async ({
    page,
    context,
  }) => {
    const homePage = new HomePage(page);
    await homePage.navigate();
    await homePage.grantConsent();
    await homePage.trackConsentEvent();

    // trackConsentEvent only waits on the sentinel's epoch, which advances
    // as soon as the fire-and-forget client-sdk track() call is issued —
    // before its underlying /api/ga4/collect request has necessarily
    // resolved and landed its identity cookies. Wait for those cookies
    // directly (canonical helper, playwright-attribute-waits skill).
    const clientId = await waitForCookieValue(context, CLIENT_ID_COOKIE);
    const session = await waitForCookieValue(context, SESSION_COOKIE);
    const anonymousId = await waitForCookieValue(context, DEFAULT_ANONYMOUS_ID_COOKIE_NAME);

    const response = await page.request.post("/api/ga4/debug", { data: DEBUG_EVENT_BODY });
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(Array.isArray(body.validationMessages)).toBe(true);

    // Read-only by design (create-debug-handler.ts): the debug call must
    // never mint or rewrite the identity a real /collect request would see.
    expect(await waitForCookieValue(context, CLIENT_ID_COOKIE)).toBe(clientId);
    expect(await waitForCookieValue(context, SESSION_COOKIE)).toBe(session);
    expect(await waitForCookieValue(context, DEFAULT_ANONYMOUS_ID_COOKIE_NAME)).toBe(anonymousId);
  });

  test("still responds successfully with no prior identity cookies present", async ({ page }) => {
    const response = await page.request.post("/api/ga4/debug", { data: DEBUG_EVENT_BODY });

    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(Array.isArray(body.validationMessages)).toBe(true);
  });
});
