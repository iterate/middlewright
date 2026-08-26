/**
 * spinner-waiter: the plugin Playwright wouldn't build.
 *
 * Extracted from the iterate monorepo's internal Playwright test
 * infrastructure (github.com/iterate/iterate, private). This implements the
 * feature requested in https://github.com/microsoft/playwright/issues/16007 -
 * a different effective action timeout while the app is visibly loading.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Locator, Page } from "@playwright/test";
import type { ActionContext, LocatorWithOriginal, Plugin } from "../plugin-system.ts";
import { adjustError, oneArgMethods } from "../plugin-system.ts";

export type SpinnerWaiterOptions = {
  /** Selectors that indicate loading state */
  spinnerSelectors?: string[];
  /** Max time to wait for spinners (ms). Default: 30_000 */
  spinnerTimeout?: number;
  /** Whether to skip spinner checking. Default: false */
  disabled?: boolean;
  /** Debug logging function */
  log?: (message: string) => void;
};

/** Match `loading...`, (or really `anyVerbing...`). Also matches an ellipsis character "…" rather than "..." since LLMs like fancy unicode. */
const loadingTextPattern = /(loading|pending|creating|verifying|starting|processing|syncing|building|\b\w+ing)[\s\w]*(\.\.\.|…)$/;

const defaultSelectors = [
  `[aria-label="Loading"]`,
  `[data-spinner='true']`,
  `:text-matches(${JSON.stringify(loadingTextPattern.source)}, "i")`,
];

const oneArgMethodNames = new Set<string>(oneArgMethods);
const enabledActionMethods = new Set<ActionContext["method"]>([
  "clear",
  "click",
  "dblclick",
  "fill",
  "focus",
  "press",
  "type",
]);

const defaults: Required<SpinnerWaiterOptions> = {
  spinnerSelectors: defaultSelectors,
  spinnerTimeout: 30_000,
  disabled: false,
  log: () => {},
};

/** AsyncLocalStorage for runtime settings override */
const settingsStorage = new AsyncLocalStorage<Partial<SpinnerWaiterOptions>>();

const getSettings = (baseOptions: SpinnerWaiterOptions = {}) => {
  const runtimeOverrides = settingsStorage.getStore() || {};
  const result = { ...defaults, ...baseOptions, ...runtimeOverrides };
  if (result.spinnerTimeout <= 3000) {
    throw new Error("spinnerTimeout must be greater than 3000ms");
  }
  return result;
};

const suggestSpinnerMessage = (spinnerLocator: Locator) => [
  `If this is a slow operation, update the product code to add a spinner while it's running.`,
  `This will improve the user experience and buy you more time for this assertion.`,
  `To add a spinner, show any UI element matching this locator:`,
  `  ${spinnerLocator}`,
];

/**
 * Creates a spinner-waiter plugin.
 *
 * Runtime settings can be overridden per-test via
 * `spinnerWaiter.settings.enterWith({...})`, or for a single call via
 * `spinnerWaiter.settings.run({...}, () => locator.click())`.
 */
export const spinnerWaiter = Object.assign(
  (options: SpinnerWaiterOptions = {}): Plugin => {
    if (process.env.PWDEBUG) {
      return { name: "spinner-waiter" };
    }

    return {
      name: "spinner-waiter",

      middleware: async ({ args, locator, method, page }, next) => {
        const settings = getSettings(options);
        if (settings.disabled) return next();

        // An explicitly passed { timeout } is the test author saying "I know
        // there is no spinner here; use this budget" — the same escape hatch
        // as settings.run({ disabled: true }) but scoped to one action. Pass
        // straight through: overriding it with the 1ms fast-fail would turn a
        // deliberate long wait into a guaranteed failure (bitten in practice
        // when popup auto-wrap put previously-raw popup actions, timeouts and
        // all, behind this middleware).
        const authorTimeout = explicitTimeout(method, args);
        if (authorTimeout !== undefined) {
          settings.log(
            `${locator}.${method}(...) carries an explicit ${authorTimeout}ms timeout — passing through`,
          );
          return next();
        }

        // waitFor({ state: "detached" | "hidden" }) waits for the target to
        // LEAVE. Spinner-waiter's whole model — fail fast unless visible
        // loading UI justifies waiting — is about things appearing; inverted
        // for disappearance it turns nonsensical (the visible "spinner" may
        // be the very thing that's disappearing). Those waits are
        // lint-discouraged in favor of positive waits; where one exists it
        // gets vanilla Playwright behavior.
        if (isDisappearanceWait(method, args)) {
          settings.log(
            `${locator}.waitFor({ state: detached|hidden }) — spinner-waiter does not deal with disappearance waits, passing through`,
          );
          return next();
        }

        const start = Date.now();
        settings.log(`${locator}.${method}(...) starting`);

        // Quick check if element is already ready for the attempted action.
        const elementReady = await waitForReady(locator, method, { timeout: 1000 });
        if (elementReady) {
          settings.log(`${locator} already ready, proceeding`);
          return next();
        }

        // Check for loading UI: an app spinner, or a navigation in flight
        // (loading UI the app cannot draw itself — see loadingVisible).
        const spinnerSelector = settings.spinnerSelectors.join(",");
        const spinnerLocator = page.locator(spinnerSelector) as LocatorWithOriginal;
        const loading = await loadingVisible(page, spinnerLocator);

        if (!loading) {
          // No spinner, no navigation - call action, suggest a spinner if it fails
          settings.log(`${locator} not ready, nothing loading, failing fast`);
          try {
            return await next(withTimeoutOption(method, args, 1));
          } catch (error) {
            adjustError(error as Error, suggestSpinnerMessage(spinnerLocator), "spinner-waiter.ts");
            throw error;
          }
        }

        settings.log(
          `Loading (spinner or navigation), waiting up to ${settings.spinnerTimeout - 2000}ms for ${locator}`,
        );

        // Something is loading — wait for the element, but bail early once loading
        // finishes (the operation completed without producing the expected element).
        const waitResult = await waitForReadyWhileSpinning(locator, method, page, spinnerLocator, {
          timeout: settings.spinnerTimeout - 2000,
        });

        if (waitResult === "appeared") {
          settings.log(`${locator} became ready after waiting`);
          return next();
        }

        if (waitResult === "spinner-gone") {
          settings.log(
            `Loading finished but element not ready — the operation completed without the expected result`,
          );
        } else {
          settings.log(`Still loading after ${settings.spinnerTimeout}ms, UI likely stuck`);
        }

        // Call action anyway (will likely fail), adjust error message
        try {
          return await next();
        } catch (error) {
          const message =
            waitResult === "spinner-gone"
              ? `Loading finished (spinner disappeared / navigation completed after ${Date.now() - start}ms) but the expected element was not ready.`
              : `Spinner was still visible after ${settings.spinnerTimeout}ms (or a navigation was still in flight), the UI is likely stuck.`;
          adjustError(error as Error, [message], "spinner-waiter.ts");
          throw error;
        }
      },
    };
  },
  {
    /** Runtime settings override via AsyncLocalStorage */
    settings: settingsStorage,
    /** Default settings values */
    defaults,
  },
);

/** waitFor({ state: "detached" | "hidden" }) — the target leaving the page. */
function isDisappearanceWait(method: ActionContext["method"], args: unknown[]) {
  const options = args[0];
  return (
    method === "waitFor" &&
    isOptionsObject(options) &&
    (options.state === "detached" || options.state === "hidden")
  );
}

async function locatorIsReady(locator: Locator, method: ActionContext["method"]) {
  const visible = await locator.isVisible();
  if (!visible) return false;
  if (!enabledActionMethods.has(method)) return true;
  return await locator.isEnabled();
}

async function waitForReady(
  locator: Locator,
  method: ActionContext["method"],
  { timeout = 1000 } = {},
) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await locatorIsReady(locator, method)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return await locatorIsReady(locator, method);
}

/** The author-passed timeout option for this action, if any. */
function explicitTimeout(method: ActionContext["method"], args: unknown[]): number | undefined {
  const options = args[oneArgMethodNames.has(method) ? 1 : 0];
  if (!isOptionsObject(options)) return undefined;
  return typeof options.timeout === "number" ? options.timeout : undefined;
}

function withTimeoutOption(method: ActionContext["method"], args: unknown[], timeout: number) {
  const optionsIndex = oneArgMethodNames.has(method) ? 1 : 0;
  const nextArgs = [...args];
  const options = nextArgs[optionsIndex];
  if (isOptionsObject(options)) {
    nextArgs[optionsIndex] = { ...options, timeout };
  } else {
    nextArgs[optionsIndex] = { timeout };
  }
  return nextArgs;
}

function isOptionsObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Wait for `target` to become ready, but bail early once loading finishes
 * (spinner gone and no navigation in flight). Returns "appeared" if target
 * became ready, "spinner-gone" if loading finished without the target, or
 * "timeout" if still loading at the deadline.
 */
async function waitForReadyWhileSpinning(
  target: Locator,
  method: ActionContext["method"],
  page: Page,
  spinner: Locator,
  { timeout = 1000 } = {},
): Promise<"appeared" | "spinner-gone" | "timeout"> {
  const start = Date.now();
  // Give loading a grace period before checking — spinners flicker during
  // transitions, and one navigation can hand off to another.
  const spinnerGracePeriodMs = 3000;
  while (Date.now() - start < timeout) {
    if (await locatorIsReady(target, method)) return "appeared";
    const elapsed = Date.now() - start;
    if (elapsed > spinnerGracePeriodMs && !(await loadingVisible(page, spinner))) return "spinner-gone";
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return "timeout";
}

/** Loading UI: a document the browser is still loading, or an app spinner. */
async function loadingVisible(page: Page, spinnerLocator: Locator): Promise<boolean> {
  return (await pageIsNavigating(page)) || (await anySpinnerVisible(spinnerLocator));
}

/**
 * A document still loading is loading UI the app cannot draw itself. The
 * reference is the browser's own tab spinner: it stays on until the document
 * fires `load` (readyState !== "complete"), and no execution context to ask
 * (the gap while a navigation commits) counts too. Playwright's locator
 * queries already wait for a pending navigation to commit, so this covers the
 * window after that: a cold page rendering its UI client-side before `load`.
 * The spinner grace period and timeout bound it, as for an app spinner.
 */
async function pageIsNavigating(page: Page): Promise<boolean> {
  if (page.isClosed()) return false;
  // page.evaluate waits for an execution context; while a navigation is
  // committing there is none, so bound the wait and count a stall as loading.
  const readyState = await Promise.race([
    page
      .evaluate(() => document.readyState)
      .catch((error) =>
        /execution context was destroyed|navigat/i.test(String(error)) ? "loading" : "complete",
      ),
    new Promise<"no-context">((resolve) => setTimeout(() => resolve("no-context"), 250)),
  ]);
  return readyState !== "complete";
}

/**
 * Multi-element-safe "is any spinner visible": the spinner selector union can
 * legitimately match several loading indicators at once (e.g. two panels each
 * showing a pending fallback), where a bare `locator.isVisible()` throws a
 * strict-mode violation. `filter({ visible: true })` needs no strictness.
 */
async function anySpinnerVisible(spinnerLocator: Locator): Promise<boolean> {
  return (await spinnerLocator.filter({ visible: true }).count()) > 0;
}

export { defaultSelectors };
