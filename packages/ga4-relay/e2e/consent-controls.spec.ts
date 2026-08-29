import { test, expect } from "@playwright/test";
import { HomePage } from "./page-objects/HomePage";
import { unregisterAllServiceWorkers } from "./helpers";

// Covers apps/demo/app/consent-controls.tsx: the demo-only CMP stand-in
// mounted alongside Ga4Init on the root route. Exercises the consent-signal
// transitions (grant, deny, deny-after-grant) and the manual track() button,
// mirroring the default-deny / grant-then-forward / deny-after-grant matrix
// documented on the component (packages/ga4-relay/src/server/consent.ts).
test.describe("Home page — ConsentControls", () => {
  test.afterEach(async ({ page }) => {
    await unregisterAllServiceWorkers(page).catch(() => undefined);
  });

  test("starts unset before any consent action", async ({ page }) => {
    const homePage = new HomePage(page);
    await homePage.navigate();

    await expect(homePage.consentControlsStatusSentinel).toHaveAttribute("data-consent-state", "unset");
    expect(await homePage.getConsentTrackEpoch()).toBe(0);
  });

  test("grant sets analytics_storage to granted", async ({ page }) => {
    const homePage = new HomePage(page);
    await homePage.navigate();

    await homePage.grantConsent();
    await homePage.verifyConsentState("granted");
  });

  test("deny sets analytics_storage to denied", async ({ page }) => {
    const homePage = new HomePage(page);
    await homePage.navigate();

    await homePage.denyConsent();
    await homePage.verifyConsentState("denied");
  });

  test("deny after grant transitions state to denied", async ({ page }) => {
    const homePage = new HomePage(page);
    await homePage.navigate();

    await homePage.grantConsent();
    await homePage.verifyConsentState("granted");

    await homePage.denyConsent();
    await homePage.verifyConsentState("denied");
  });

  test("track button advances the track epoch on each click", async ({ page }) => {
    const homePage = new HomePage(page);
    await homePage.navigate();

    await homePage.grantConsent();

    await homePage.trackConsentEvent();
    await homePage.verifyConsentTrackEpoch(1);

    await homePage.trackConsentEvent();
    await homePage.verifyConsentTrackEpoch(2);
  });
});
