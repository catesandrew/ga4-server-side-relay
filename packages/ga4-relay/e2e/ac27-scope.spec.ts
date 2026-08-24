import { test, expect } from "@playwright/test";
import {
  RESILIENCE_SW_SCOPE_PATH,
  RESILIENCE_SW_SCRIPT_PATH,
  getRegistrationSummaries,
  registerAndWaitForActive,
  unregisterAllServiceWorkers,
  waitForRegistrationActive,
} from "./helpers";

// AC27: registering the resilience SW with a nested scope results in
// registration.scope matching that nested scope in a real browser — the
// browser-side counterpart to the header-level Service-Worker-Allowed
// assertion already covered in create-service-worker-handler.test.ts.
test.describe("AC27 — resilience SW registers at its configured nested scope", () => {
  test.afterEach(async ({ page }) => {
    await unregisterAllServiceWorkers(page).catch(() => undefined);
  });

  test("ga4-init.tsx's auto-registration resolves registration.scope to /ga4-relay/", async ({ page, baseURL }) => {
    await page.goto("/");
    await waitForRegistrationActive(page, RESILIENCE_SW_SCOPE_PATH);

    // A single read right after waitForRegistrationActive resolves can catch
    // a transient moment (observed live, cause not conclusively isolated —
    // possibly Chromium-level SW bookkeeping settling, unrelated to the
    // package's own single register() call, which was confirmed via
    // instrumented reproduction) — poll for the active state to be STABLE
    // across a short window, not just true on one instantaneous read.
    await expect
      .poll(async () => {
        const regs = await getRegistrationSummaries(page);
        return regs.find((r) => r.scope.includes(RESILIENCE_SW_SCOPE_PATH))?.active ?? false;
      }, { timeout: 5_000 })
      .toBe(true);
    await page.waitForTimeout(250);

    const registrations = await getRegistrationSummaries(page);
    const resilienceReg = registrations.find((r) => r.scope.includes(RESILIENCE_SW_SCOPE_PATH));

    expect(resilienceReg).toBeDefined();
    expect(resilienceReg?.active).toBe(true);
    expect(resilienceReg?.scope).toBe(new URL(RESILIENCE_SW_SCOPE_PATH, baseURL ?? "http://localhost:3000").href);
  });

  test("an explicit navigator.serviceWorker.register() call against the served SW script resolves with the requested scope", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/");
    // Clear the auto-registration from ga4-init.tsx first so this explicit
    // call is exercising registration from a clean slate.
    await unregisterAllServiceWorkers(page);

    const scope = await registerAndWaitForActive(page, RESILIENCE_SW_SCRIPT_PATH, RESILIENCE_SW_SCOPE_PATH);

    expect(scope).toBe(new URL(RESILIENCE_SW_SCOPE_PATH, baseURL ?? "http://localhost:3000").href);
  });
});
