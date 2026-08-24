// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { getCurrentConsent, isCurrentlyDenied, onConsentChange } from "./consent-bridge.js";

afterEach(() => {
  (globalThis as { __ga4RelayConsent?: unknown }).__ga4RelayConsent = undefined;
});

describe("consent-bridge.ts", () => {
  it("reads the documented window.__ga4RelayConsent contract", () => {
    (window as unknown as { __ga4RelayConsent: unknown }).__ga4RelayConsent = {
      ad_storage: "granted",
      ad_user_data: "granted",
      ad_personalization: "granted",
      analytics_storage: "granted",
    };
    expect(getCurrentConsent()?.analytics_storage).toBe("granted");
    expect(isCurrentlyDenied()).toBe(false);
  });

  it("treats an unset consent as denied", () => {
    expect(isCurrentlyDenied()).toBe(true);
  });

  it("fires the callback when the ga4-relay:consent CustomEvent dispatches", () => {
    let received: unknown;
    const unsubscribe = onConsentChange((consent) => {
      received = consent;
    });
    window.dispatchEvent(
      new CustomEvent("ga4-relay:consent", {
        detail: { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "denied" },
      }),
    );
    expect(received).toMatchObject({ analytics_storage: "denied" });
    unsubscribe();
  });
});
