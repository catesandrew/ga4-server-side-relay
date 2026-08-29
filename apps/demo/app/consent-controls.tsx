"use client";

import { useState } from "react";
import { getGa4Client } from "../lib/ga4-client";
import { DEMO_TEST_IDS } from "../lib/test-ids/catalog";

type ConsentState = "granted" | "denied";

/**
 * Shape of the Consent Mode v2 signal the ga4-relay client SDK's
 * consent-bridge contract expects on `window.__ga4RelayConsent`
 * (packages/ga4-relay/src/client/consent-bridge.ts) — not imported from the
 * package because its public `./client` entry point doesn't export this
 * type, only the functions that consume it.
 */
interface Ga4RelayConsentSignal {
  ad_storage: ConsentState;
  ad_user_data: ConsentState;
  ad_personalization: ConsentState;
  analytics_storage: ConsentState;
}

type Ga4RelayGlobal = typeof window & { __ga4RelayConsent?: Ga4RelayConsentSignal };

function publishConsent(analyticsStorage: ConsentState): void {
  const signal: Ga4RelayConsentSignal = {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: analyticsStorage,
  };
  (window as Ga4RelayGlobal).__ga4RelayConsent = signal;
  window.dispatchEvent(new CustomEvent("ga4-relay:consent", { detail: signal }));
}

/**
 * Demo-only CMP stand-in: the ga4-relay client SDK never produces consent
 * signals itself (see consent-bridge.ts's documented contract), so
 * something upstream has to. This drives that contract manually — grant/deny
 * buttons plus a track button so a Playwright spec can exercise the full
 * default-deny / grant-then-forward / deny-after-grant-deletes-cookie /
 * deny-with-no-cookie-is-a-no-op matrix (packages/ga4-relay/src/server/
 * consent.ts) end-to-end against the real collect route.
 */
export function ConsentControls() {
  const [consentState, setConsentState] = useState<ConsentState | "unset">("unset");
  const [trackEpoch, setTrackEpoch] = useState(0);

  function handleGrant() {
    publishConsent("granted");
    setConsentState("granted");
  }

  function handleDeny() {
    publishConsent("denied");
    setConsentState("denied");
  }

  function handleTrack() {
    try {
      getGa4Client().track({ event_id: crypto.randomUUID(), name: "consent_controls_track", params: {} });
      setTrackEpoch((epoch) => epoch + 1);
    } catch (error) {
      console.error("ConsentControls: failed to track event", error);
    }
  }

  const statusMessage =
    consentState === "granted"
      ? "Analytics consent granted."
      : consentState === "denied"
        ? "Analytics consent denied."
        : "";

  return (
    <div role="group" aria-label="Analytics consent controls">
      <button
        type="button"
        data-testid={DEMO_TEST_IDS.consentControls.grantButton}
        aria-pressed={consentState === "granted"}
        onClick={handleGrant}
      >
        Grant analytics consent
      </button>
      <button
        type="button"
        data-testid={DEMO_TEST_IDS.consentControls.denyButton}
        aria-pressed={consentState === "denied"}
        onClick={handleDeny}
      >
        Deny analytics consent
      </button>
      <button type="button" data-testid={DEMO_TEST_IDS.consentControls.trackButton} onClick={handleTrack}>
        Track event
      </button>
      <p aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>
        {statusMessage}
      </p>
      <div
        data-testid={DEMO_TEST_IDS.consentControls.statusSentinel}
        data-consent-state={consentState}
        data-track-epoch={trackEpoch}
        aria-hidden="true"
        style={{ display: "none" }}
      />
    </div>
  );
}
