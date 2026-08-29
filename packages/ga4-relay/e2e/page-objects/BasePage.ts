import type { Page } from "@playwright/test";
import { waitForPageSettled } from "../wait/readiness";

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
   * returning control to the caller. Route-agnostic, so it has no
   * per-element attribute to gate on — `waitForPageSettled` (canonical
   * wait/readiness module) is the degrade-gracefully fallback for that case.
   */
  async navigate(): Promise<void> {
    await this.page.goto(this.route);
    await waitForPageSettled(this.page);
  }
}
