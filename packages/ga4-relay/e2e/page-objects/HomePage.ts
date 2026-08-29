import { expect, type Locator } from "@playwright/test";
import { DEMO_TEST_IDS } from "../../../../apps/demo/lib/test-ids/catalog.mirror";
import { BasePage } from "./BasePage";
import { waitForAttributeValue, waitForEpochAdvance } from "../wait/readiness";

type ConsentState = "granted" | "denied";

/**
 * Page object for the demo app's root route (`apps/demo/app/page.tsx`).
 * `Ga4Init` (`apps/demo/app/ga4-init.tsx`) and `ConsentControls`
 * (`apps/demo/app/consent-controls.tsx`) both mount here, so their hidden
 * status sentinels are observable on this one page object.
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

  /**
   * Readiness gate: waits for Ga4Init to leave `idle` and reach `tracked`
   * (canonical helper — playwright-attribute-waits skill, invariant 1)
   * before any assertion or follow-on interaction depends on tracking having
   * fired.
   */
  async waitForGa4Tracked(): Promise<void> {
    await waitForAttributeValue(this.ga4InitStatusSentinel, "data-state", "tracked");
  }

  /** Asserts the auto page_view has fired exactly once (Ga4Init reached `tracked`, epoch === 1). */
  async verifyGa4Tracked(): Promise<void> {
    await this.waitForGa4Tracked();
    await expect(this.ga4InitStatusSentinel).toHaveAttribute("aria-busy", "false");
    await expect(this.ga4InitStatusSentinel).toHaveAttribute("data-track-epoch", "1");
  }

  // Role-based (invariant 2): each button carries visible, unique text, so
  // an accessible-name selector both finds it and doubles as a live a11y
  // check — no need to reach for the catalog testid here.
  get consentGrantButton(): Locator {
    return this.page.getByRole("button", { name: "Grant analytics consent" });
  }

  get consentDenyButton(): Locator {
    return this.page.getByRole("button", { name: "Deny analytics consent" });
  }

  get consentTrackButton(): Locator {
    return this.page.getByRole("button", { name: "Track event" });
  }

  // Hidden (aria-hidden, display:none) and carries no accessible role or
  // name of its own, so the typed catalog id is the correct selector here,
  // same rationale as ga4InitStatusSentinel above.
  get consentControlsStatusSentinel(): Locator {
    return this.page.getByTestId(DEMO_TEST_IDS.consentControls.statusSentinel);
  }

  /** Reads the sentinel's `data-track-epoch` attribute as a number. */
  async getConsentTrackEpoch(): Promise<number> {
    const value = await this.consentControlsStatusSentinel.getAttribute("data-track-epoch");
    return Number(value ?? 0);
  }

  /** Clicks grant and waits for the sentinel to reflect `analytics_storage: 'granted'`. */
  async grantConsent(): Promise<void> {
    await this.consentGrantButton.click();
    await waitForAttributeValue(this.consentControlsStatusSentinel, "data-consent-state", "granted");
  }

  /** Clicks deny and waits for the sentinel to reflect `analytics_storage: 'denied'`. */
  async denyConsent(): Promise<void> {
    await this.consentDenyButton.click();
    await waitForAttributeValue(this.consentControlsStatusSentinel, "data-consent-state", "denied");
  }

  /**
   * Fires a manual track() call via the Track event button and waits for the
   * sentinel's epoch to advance (invariant 4 epoch-fencing) — captures the
   * epoch before the click so the wait can't mistake a prior cycle's value
   * for this one's.
   */
  async trackConsentEvent(): Promise<void> {
    const fromEpoch = await this.getConsentTrackEpoch();
    await this.consentTrackButton.click();
    await waitForEpochAdvance(this.consentControlsStatusSentinel, "data-track-epoch", fromEpoch);
  }

  /** Asserts the consent sentinel currently reflects the given consent state. */
  async verifyConsentState(state: ConsentState): Promise<void> {
    await expect(this.consentControlsStatusSentinel).toHaveAttribute("data-consent-state", state);
  }

  /** Asserts the consent sentinel's track epoch equals the given value. */
  async verifyConsentTrackEpoch(epoch: number): Promise<void> {
    await expect(this.consentControlsStatusSentinel).toHaveAttribute("data-track-epoch", String(epoch));
  }
}
