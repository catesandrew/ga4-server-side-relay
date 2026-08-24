import { test, expect } from "@playwright/test";
import {
  RESILIENCE_SW_SCOPE_PATH,
  TEST_SW_SCRIPT_PATH,
  getRegistrationSummaries,
  registerAndWaitForActive,
  unregisterAllServiceWorkers,
  waitForRegistrationActive,
} from "./helpers";

// AC14: registering the resilience SW must never deregister (or be
// deregistered by) a host site's own pre-existing service worker that is
// already controlling the page. Simulated here with a trivial no-op SW
// (apps/demo/public/test-sw.js) registered at root scope BEFORE the
// resilience SW registers itself at the nested /ga4-relay/ scope.
test.describe("AC14 — resilience SW coexists with an existing host SW", () => {
  test.afterEach(async ({ page }) => {
    await unregisterAllServiceWorkers(page).catch(() => undefined);
  });

  test("both the host SW (root scope) and the resilience SW (/ga4-relay/ scope) remain registered and active", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/");

    // Simulate a host site's SW that already controls the page at root
    // scope, registered BEFORE the resilience SW settles.
    const rootScope = await registerAndWaitForActive(page, TEST_SW_SCRIPT_PATH);
    expect(rootScope).toBe(new URL("/", baseURL ?? "http://localhost:3000").href);

    // The resilience SW registers automatically via Ga4Init's useEffect at
    // page load (client-sdk.ts registerServiceWorker(), nested scope).
    await waitForRegistrationActive(page, RESILIENCE_SW_SCOPE_PATH);

    const afterBoth = await getRegistrationSummaries(page);
    expect(afterBoth).toHaveLength(2);
    expect(afterBoth.every((r) => r.active)).toBe(true);

    const hostReg = afterBoth.find((r) => r.scope === new URL("/", baseURL ?? "http://localhost:3000").href);
    const resilienceReg = afterBoth.find((r) => r.scope.includes(RESILIENCE_SW_SCOPE_PATH));
    expect(hostReg, "host SW registration should still be present").toBeDefined();
    expect(resilienceReg, "resilience SW registration should still be present").toBeDefined();

    // Reload the page — if registering either SW had silently deregistered
    // the other, this count would have dropped back to 1.
    await page.reload();
    await waitForRegistrationActive(page, RESILIENCE_SW_SCOPE_PATH);
    const afterReload = await getRegistrationSummaries(page);
    expect(afterReload).toHaveLength(2);
    expect(afterReload.every((r) => r.active)).toBe(true);
  });
});
