import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";

/**
 * Canonical readiness/locators helper module (playwright-attribute-waits
 * skill, invariant 1). Every spec and page-object method in this suite that
 * needs to wait on async state imports from here rather than re-deriving its
 * own polling loop, so the wait contract can only drift in one place.
 */

export interface WaitOptions {
  timeout?: number;
}

const DEFAULT_TIMEOUT = 10_000;

/**
 * State gate: waits for `attr` on `locator` to equal `value`. `toHaveAttribute`
 * auto-retries under the hood, so this is the canonical replacement for a
 * bespoke inline polling loop or a `waitForTimeout` guess.
 */
export async function waitForAttributeValue(
  locator: Locator,
  attr: string,
  value: string,
  opts: WaitOptions = {},
): Promise<void> {
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
  await expect(locator).toHaveAttribute(attr, value, { timeout });
}

/**
 * Epoch-fencing (invariant 4). Capture `fromEpoch` BEFORE triggering the
 * action that should advance it, then poll until the attribute's numeric
 * value is strictly greater. Pair with a structural assertion at the call
 * site when the triggering action is destructive — the epoch alone can't
 * distinguish "the action you just triggered finished" from "a prior cycle's
 * terminal value is still sitting there" if two cycles ever produced the
 * same epoch (they shouldn't, but the structural check is the belt-and-
 * suspenders per the skill).
 */
export async function waitForEpochAdvance(
  locator: Locator,
  attr: string,
  fromEpoch: number,
  opts: WaitOptions = {},
): Promise<void> {
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
  await expect
    .poll(async () => {
      const raw = await locator.getAttribute(attr);
      return raw === null ? Number.NaN : Number(raw);
    }, { timeout })
    .toBeGreaterThan(fromEpoch);
}

/**
 * Degrade-gracefully page-level settle point (invariant 8) for navigation
 * steps that have no per-element attribute to gate on yet — e.g. the
 * generic `BasePage.navigate()` step, which is route-agnostic and can't
 * assume any particular component's readiness attributes.
 */
export async function waitForPageSettled(page: Page, opts: WaitOptions = {}): Promise<void> {
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
  await page.waitForLoadState("networkidle", { timeout });
}

/**
 * State gate for a browser cookie rather than a DOM attribute — needed when
 * the action under test (e.g. a fire-and-forget client-sdk `track()` call)
 * returns before the identity cookie its request sets has actually landed
 * in the context's cookie jar. Polls `context.cookies()` (real browser
 * state, no mocking) until `name` appears, then returns its value; this is
 * the canonical replacement for a `waitForTimeout` guess at how long the
 * in-flight request takes to resolve.
 */
export async function waitForCookieValue(
  context: BrowserContext,
  name: string,
  opts: WaitOptions = {},
): Promise<string> {
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
  await expect
    .poll(async () => {
      const cookies = await context.cookies();
      return cookies.some((cookie) => cookie.name === name);
    }, { timeout })
    .toBe(true);
  const cookies = await context.cookies();
  const match = cookies.find((cookie) => cookie.name === name);
  if (!match) {
    throw new Error(`Cookie "${name}" was observed present, then vanished before it could be read.`);
  }
  return match.value;
}
