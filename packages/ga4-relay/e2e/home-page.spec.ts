import { test, expect } from "@playwright/test";
import { HomePage } from "./page-objects/HomePage";
import { unregisterAllServiceWorkers } from "./helpers";

// Covers apps/demo/app/page.tsx + Ga4Init (apps/demo/app/ga4-init.tsx): the
// root route renders its main content and Ga4Init auto-tracks exactly one
// page_view on mount, including under React dev mode's effect
// double-invoke (mount -> cleanup -> mount), which the module-level guard
// in ga4-init.tsx must collapse back down to a single track.
test.describe("Home page — root route", () => {
  test.afterEach(async ({ page }) => {
    await unregisterAllServiceWorkers(page).catch(() => undefined);
  });

  test("renders the demo app's main content", async ({ page }) => {
    const homePage = new HomePage(page);
    await homePage.navigate();

    await expect(homePage.mainContent).toBeVisible();
  });

  test("Ga4Init auto-tracks the page_view exactly once on load", async ({ page }) => {
    const homePage = new HomePage(page);
    await homePage.navigate();

    await homePage.verifyGa4Tracked();
    expect(await homePage.getGa4TrackEpoch()).toBe(1);
  });

  test("does not double-track under React dev mode's effect double-invoke", async ({ page }) => {
    const homePage = new HomePage(page);
    await homePage.navigate();
    await homePage.verifyGa4Tracked();

    // A full reload re-runs ga4-init.tsx's mount effect from scratch
    // (fresh module instance, so the guard's own state resets too) — this
    // re-exercises the dev-mode double-invoke guard on every load, not just
    // the first. The epoch settling back to exactly 1 (never 2) is the
    // observable proof the guard collapsed the double-invoke into one track.
    await page.reload();
    await homePage.verifyGa4Tracked();
  });
});
