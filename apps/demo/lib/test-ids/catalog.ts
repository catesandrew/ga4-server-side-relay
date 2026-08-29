import { createTestIdRegistry } from "./registry";

/**
 * Typed data-testid catalog for the demo app. Keys are nested by
 * component/feature area; element suffixes document what DOM role each id
 * targets (e.g. `-status-sentinel` for a hidden, always-mounted state
 * marker element).
 */
export const DEMO_TEST_IDS = createTestIdRegistry({
  ga4Init: {
    /**
     * Hidden, always-mounted sentinel rendered by Ga4Init carrying
     * data-state/data-track-epoch/aria-busy so Playwright can observe the
     * page_view auto-track (and the dev-mode double-invoke guard) without
     * needing any visible UI.
     */
    statusSentinel: "ga4-init-status-sentinel",
  },
  consentControls: {
    /** Sets `analytics_storage: 'granted'` and dispatches the `ga4-relay:consent` contract event. */
    grantButton: "consent-controls-grant-button",
    /** Sets `analytics_storage: 'denied'` and dispatches the `ga4-relay:consent` contract event. */
    denyButton: "consent-controls-deny-button",
    /** Fires a manual track() call through the shared GA4 client, using whatever consent is currently set. */
    trackButton: "consent-controls-track-button",
    /**
     * Hidden, always-mounted sentinel carrying data-consent-state/
     * data-track-epoch so Playwright can observe consent transitions and
     * manual track() calls without needing any visible UI.
     */
    statusSentinel: "consent-controls-status-sentinel",
  },
});
