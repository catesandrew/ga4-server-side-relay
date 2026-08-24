import { describe, expect, it } from "vitest";
import { isDenied, isExplicitDenial, isWithdrawal } from "./consent.js";
import type { ConsentSignal } from "../shared/event.js";

const granted: ConsentSignal = {
  ad_storage: "granted",
  ad_user_data: "granted",
  ad_personalization: "granted",
  analytics_storage: "granted",
};

const denied: ConsentSignal = {
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
  analytics_storage: "denied",
};

describe("consent.ts", () => {
  describe("isDenied (AC6/AC6a)", () => {
    it("is not denied when analytics_storage is granted", () => {
      expect(isDenied(granted)).toBe(false);
    });

    it("is denied when analytics_storage is denied", () => {
      expect(isDenied(denied)).toBe(true);
    });

    it("AC6a: is denied (default-deny) when the consent object is absent", () => {
      expect(isDenied(undefined)).toBe(true);
    });

    it("is denied for the two mixed signal combinations that leave analytics_storage denied", () => {
      expect(isDenied({ ...granted, analytics_storage: "denied" })).toBe(true);
      expect(isDenied({ ...denied, ad_storage: "granted", analytics_storage: "denied" })).toBe(true);
    });
  });

  describe("isExplicitDenial vs absent (AC31 gating)", () => {
    it("is explicit only when the object is present and analytics_storage is denied", () => {
      expect(isExplicitDenial(denied)).toBe(true);
      expect(isExplicitDenial(granted)).toBe(false);
      expect(isExplicitDenial(undefined)).toBe(false);
    });
  });

  describe("isWithdrawal (AC31)", () => {
    it("is a withdrawal only when explicit denial is paired with an existing cookie", () => {
      expect(isWithdrawal(denied, true)).toBe(true);
      expect(isWithdrawal(denied, false)).toBe(false);
      expect(isWithdrawal(undefined, true)).toBe(false); // absent object never triggers deletion
    });
  });
});
