import type { Page } from "@playwright/test";

/** Scope client-sdk.ts + ga4-init.tsx configure for the resilience SW. */
export const RESILIENCE_SW_SCOPE_PATH = "/ga4-relay/";
export const RESILIENCE_SW_SCRIPT_PATH = "/ga4-relay/ga4-sw.js";
/** Trivial no-op SW served from apps/demo/public/test-sw.js, root scope. */
export const TEST_SW_SCRIPT_PATH = "/test-sw.js";

export interface RegistrationSummary {
  scope: string;
  active: boolean;
  activeState: string | null;
}

/**
 * Polls navigator.serviceWorker.getRegistrations() (real browser API, no
 * mocking) until a registration whose scope contains `scopeSubstring` has
 * an active worker. Playwright's waitForFunction re-invokes the predicate
 * — including awaiting a returned Promise — until it resolves truthy.
 */
export async function waitForRegistrationActive(page: Page, scopeSubstring: string): Promise<void> {
  await page.waitForFunction(
    async (needle) => {
      const regs = await navigator.serviceWorker.getRegistrations();
      // registration.active is populated as soon as the worker enters
      // "activating", not just once it reaches "activated" — checking only
      // Boolean(r.active) let this resolve one tick before the worker was
      // actually done activating, so a follow-up read moments later (a real
      // round trip away, in a separate page.evaluate call) could catch it
      // mid-transition. Require the fully "activated" state instead.
      return regs.some((r) => r.scope.includes(needle) && r.active?.state === "activated");
    },
    scopeSubstring,
    { timeout: 15_000 },
  );
}

/** Snapshot of every current SW registration's scope + active-worker state. */
export async function getRegistrationSummaries(page: Page): Promise<RegistrationSummary[]> {
  return page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    return regs.map((r) => ({
      scope: r.scope,
      active: Boolean(r.active),
      activeState: r.active?.state ?? null,
    }));
  });
}

/** Test cleanup only — unregisters every SW registered during a test so state never leaks across tests. */
export async function unregisterAllServiceWorkers(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  });
}

/**
 * Registers `scriptUrl` (optionally at `scope`) via the real
 * navigator.serviceWorker.register() API and resolves once the resulting
 * registration has an active worker. Returns the registration's resolved
 * scope string.
 */
export async function registerAndWaitForActive(
  page: Page,
  scriptUrl: string,
  scope?: string,
): Promise<string> {
  return page.evaluate(
    async ({ scriptUrl, scope }) => {
      const registration = await navigator.serviceWorker.register(scriptUrl, scope ? { scope } : undefined);
      await new Promise<void>((resolve) => {
        if (registration.active) {
          resolve();
          return;
        }
        const worker = registration.installing ?? registration.waiting;
        if (!worker) {
          resolve();
          return;
        }
        worker.addEventListener("statechange", function onChange() {
          if (worker.state === "activated") {
            worker.removeEventListener("statechange", onChange);
            resolve();
          }
        });
      });
      return registration.scope;
    },
    { scriptUrl, scope },
  );
}
