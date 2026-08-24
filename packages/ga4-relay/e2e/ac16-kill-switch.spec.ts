import { test, expect } from "@playwright/test";
import {
  RESILIENCE_SW_SCOPE_PATH,
  getRegistrationSummaries,
  unregisterAllServiceWorkers,
  waitForRegistrationActive,
} from "./helpers";

// AC16: the kill-switch flow's main-thread path (client-sdk.ts's
// applyKillSwitchViaStoredRegistration -> registration.unregister()) must
// leave the site fully functional afterwards — unregistering the SW is not
// allowed to break the page.
test.describe("AC16 — site keeps functioning after the resilience SW is unregistered", () => {
  test.afterEach(async ({ page }) => {
    await unregisterAllServiceWorkers(page).catch(() => undefined);
  });

  test("registration.unregister() removes the SW and the page continues to load and render normally", async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));

    await page.goto("/");
    await waitForRegistrationActive(page, RESILIENCE_SW_SCOPE_PATH);

    let regs = await getRegistrationSummaries(page);
    expect(regs.some((r) => r.scope.includes(RESILIENCE_SW_SCOPE_PATH))).toBe(true);

    const unregisterResult = await page.evaluate(async (scopeSubstring) => {
      const all = await navigator.serviceWorker.getRegistrations();
      const target = all.find((r) => r.scope.includes(scopeSubstring));
      if (!target) return false;
      return target.unregister();
    }, RESILIENCE_SW_SCOPE_PATH);
    expect(unregisterResult).toBe(true);

    regs = await getRegistrationSummaries(page);
    expect(regs.some((r) => r.scope.includes(RESILIENCE_SW_SCOPE_PATH))).toBe(false);

    // Site continues functioning: a fresh navigation succeeds, the page's
    // own content renders, and nothing throws an uncaught error as a result
    // of the SW being gone.
    const response = await page.reload();
    expect(response?.ok()).toBe(true);
    await expect(page.locator("body")).toContainText("ga4-relay demo");
    expect(pageErrors).toHaveLength(0);
  });
});
