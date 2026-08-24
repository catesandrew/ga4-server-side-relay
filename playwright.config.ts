import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./packages/ga4-relay/e2e",
  fullyParallel: true,
  webServer: {
    command: "pnpm --filter demo dev",
    port: 3000,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: "http://localhost:3000",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
