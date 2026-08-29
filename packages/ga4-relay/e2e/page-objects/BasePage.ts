import type { Page } from "@playwright/test";

/**
 * Shared base class every page object in this suite extends. Owns the one
 * piece of contract common to every page — the route, the constructor
 * shape, and the navigate-then-settle sequence — so individual page
 * objects stay focused on their own locators, actions, and assertions.
 */
export abstract class BasePage {
  /** The route this page object represents, relative to `playwright.config.ts`'s `baseURL`. */
  abstract readonly route: string;

  constructor(protected readonly page: Page) {}

  /**
   * Navigates to this page's route and waits for it to settle before
   * returning control to the caller.
   *
   * No project-specific attribute-readiness helper exists in this suite
   * yet (that's the sibling playwright-attribute-waits skill's concern) —
   * `waitForLoadState('networkidle')` is the documented fallback until one
   * is wired in. Swap this for the real helper once it lands.
   */
  async navigate(): Promise<void> {
    await this.page.goto(this.route);
    await this.page.waitForLoadState("networkidle");
  }
}
