/**
 * Playwright-side mirror of the demo app's test-id catalog.
 *
 * A straight re-export is sufficient here: the catalog module has no
 * browser-only or server-only dependencies, so importing it directly from
 * spec/page-object code is safe and keeps app and test code reading the
 * exact same object — zero string duplication.
 */
export { DEMO_TEST_IDS } from "./catalog";
