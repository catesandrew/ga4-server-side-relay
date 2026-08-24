import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./packages/ga4-relay/e2e",
  fullyParallel: true,
  webServer: {
    // Explicit non-default port: 3000 is commonly occupied by an unrelated
    // dev server on a developer machine, and reuseExistingServer would then
    // silently point every e2e spec at that other app's response instead of
    // failing loudly (found live in this environment — see
    // docs/spikes/playwright-browser-e2e.md).
    //
    // Production build, not `next dev`: dev mode's on-demand route
    // compilation triggers a client-side reload the first time a
    // not-yet-compiled route (here, /ga4-relay/ga4-sw.js) is requested —
    // an extra `framenavigated` event fires ~20-30ms after the initial
    // `load`, racing the resilience SW's registration and non-deterministically
    // resetting it mid-activation (live-reproduced via instrumented
    // page.on("framenavigated") logging — see docs/spikes/playwright-browser-e2e.md).
    // This is a dev-server-only artifact, not a product bug — a real
    // production build never does this on-demand reload, and it's also the
    // more correct target for validating real browser SW behavior anyway.
    command: "pnpm --filter demo exec next build && pnpm --filter demo exec next start -p 3457",
    port: 3457,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    baseURL: "http://localhost:3457",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
