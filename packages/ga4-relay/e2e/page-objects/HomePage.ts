import { expect, type Locator } from "@playwright/test";
import { DEMO_TEST_IDS } from "../../../../apps/demo/lib/test-ids/catalog.mirror";
import { BasePage } from "./BasePage";

/**
 * Page object for the demo app's root route (`apps/demo/app/page.tsx`).
 * `Ga4Init` (`apps/demo/app/ga4-init.tsx`) mounts in the root layout, so
 * its hidden status sentinel is observable here.
 */
export class HomePage extends BasePage {
  readonly route = "/";

  /** `<main>` content rendered by `apps/demo/app/page.tsx`. */
  get mainContent(): Locator {
    return this.page.getByRole("main");
  }

  // Hidden (aria-hidden, display:none) and carries no accessible role or
  // name of its own — it exists purely as a state marker for Playwright, so
  // a role/label selector isn't available and the typed catalog id
  // (invariant 2's data-testid fallback) is the correct selector here.
  get ga4InitStatusSentinel(): Locator {
    return this.page.getByTestId(DEMO_TEST_IDS.ga4Init.statusSentinel);
  }

  /** Reads the sentinel's `data-track-epoch` attribute as a number. */
  async getGa4TrackEpoch(): Promise<number> {
    const value = await this.ga4InitStatusSentinel.getAttribute("data-track-epoch");
    return Number(value ?? 0);
  }

  /** Asserts the auto page_view has fired exactly once (Ga4Init reached `tracked`, epoch === 1). */
  async verifyGa4Tracked(): Promise<void> {
    await expect(this.ga4InitStatusSentinel).toHaveAttribute("data-state", "tracked");
    await expect(this.ga4InitStatusSentinel).toHaveAttribute("aria-busy", "false");
    await expect(this.ga4InitStatusSentinel).toHaveAttribute("data-track-epoch", "1");
  }
}
