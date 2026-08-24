import type { ConsentSignal } from "../shared/event.js";

/**
 * AC6/AC6a: analytics_storage:'denied' or an absent consent object is
 * treated as fully denied (default-deny, no implicit grant).
 */
export function isDenied(consent: ConsentSignal | undefined): boolean {
  if (!consent) return true;
  return consent.analytics_storage !== "granted";
}

/**
 * Distinguishes an explicit denial (a real consent-transition signal) from
 * an absent consent object (which carries no information about whether
 * this is a withdrawal or a first visit). Only an explicit denial, combined
 * with an existing relay cookie, should trigger cookie deletion (AC31) —
 * an absent object must never attempt deletion, since it can't tell.
 */
export function isExplicitDenial(consent: ConsentSignal | undefined): boolean {
  return consent !== undefined && consent.analytics_storage === "denied";
}

export function isWithdrawal(consent: ConsentSignal | undefined, hasExistingCookie: boolean): boolean {
  return isExplicitDenial(consent) && hasExistingCookie;
}
