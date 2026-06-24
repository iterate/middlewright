/**
 * spinner-waiter: the plugin Playwright wouldn't build.
 *
 * Extracted from the iterate monorepo's internal Playwright test
 * infrastructure (github.com/iterate/iterate, private). This implements the
 * feature requested in https://github.com/microsoft/playwright/issues/16007 -
 * a different effective action timeout while the app is visibly loading.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Locator } from "@playwright/test";
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

        const start = Date.now();
        settings.log(`${locator}.${method}(...) starting`);

        // Quick check if element is already ready for the attempted action.
        const elementReady = await waitForReady(locator, method, { timeout: 1000 });
        if (elementReady) {
          settings.log(`${locator} already ready, proceeding`);
          return next();
        }

        // Check for spinner
        const spinnerSelector = settings.spinnerSelectors.join(",");
        const spinnerLocator = page.locator(spinnerSelector) as LocatorWithOriginal;
        const spinnerVisible = await spinnerLocator.isVisible();

        if (!spinnerVisible) {
          // No spinner - call action, suggest adding one if it fails
          settings.log(`${locator} not ready, no spinner, failing fast`);
          try {
            return await next(withTimeoutOption(method, args, 1));
          } catch (error) {
            adjustError(error as Error, suggestSpinnerMessage(spinnerLocator), "spinner-waiter.ts");
            throw error;
          }
        }

        settings.log(
          `Spinner visible, waiting up to ${settings.spinnerTimeout - 2000}ms for ${locator}`,
        );

        // Spinner is visible — wait for the element, but bail early if the spinner
        // disappears (the loading operation finished without producing the expected element).
        const waitResult = await waitForReadyWhileSpinning(locator, method, spinnerLocator, {
          timeout: settings.spinnerTimeout - 2000,
        });

        if (waitResult === "appeared") {
          settings.log(`${locator} became ready after waiting`);
          return next();
        }

        if (waitResult === "spinner-gone") {
          settings.log(
            `Spinner disappeared but element not ready — loading finished without expected result`,
          );
        } else {
          settings.log(`Spinner still visible after ${settings.spinnerTimeout}ms, UI likely stuck`);
        }

        // Call action anyway (will likely fail), adjust error message
        try {
          return await next();
        } catch (error) {
          const message =
            waitResult === "spinner-gone"
              ? `Loading finished (spinner disappeared after ${Date.now() - start}ms) but the expected element was not ready.`
              : `Spinner was still visible after ${settings.spinnerTimeout}ms, the UI is likely stuck.`;
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

async function locatorIsReady(locator: Locator, method: ActionContext["method"]) {
  if (!(await locator.isVisible())) return false;
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
 * Wait for `target` to become ready, but bail early if `spinner` disappears.
 * Returns "appeared" if target became ready, "spinner-gone" if loading finished
 * without the target, or "timeout" if spinner was still visible at deadline.
 */
async function waitForReadyWhileSpinning(
  target: Locator,
  method: ActionContext["method"],
  spinner: Locator,
  { timeout = 1000 } = {},
): Promise<"appeared" | "spinner-gone" | "timeout"> {
  const start = Date.now();
  // Give the spinner a grace period before checking — it may flicker during transitions
  const spinnerGracePeriodMs = 3000;
  while (Date.now() - start < timeout) {
    if (await locatorIsReady(target, method)) return "appeared";
    const elapsed = Date.now() - start;
    if (elapsed > spinnerGracePeriodMs && !(await spinner.isVisible())) return "spinner-gone";
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return "timeout";
}

export { defaultSelectors };
