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
});
