/**
 * hydration-waiter: don't interact with the app before it's interactive.
 *
 * Extracted from the iterate monorepo's internal Playwright test
 * infrastructure (github.com/iterate/iterate, private).
 */
import type { Plugin, LocatorWithOriginal } from "../plugin-system.ts";

export type HydrationWaiterOptions = {
  /** Selector for unhydrated state. Default: '[data-hydrated="false"]' */
  selector?: string;
  /** Timeout for hydration. Default: 10_000 */
  timeout?: number;
  /** Whether to skip this plugin. Default: false */
  disabled?: boolean;
};

/**
 * Waits for the app to be hydrated before any locator action.
 * Looks for `[data-hydrated="false"]` and waits for it to disappear.
 *
 * Your app needs to cooperate: render `data-hydrated="false"` on some element
 * server-side and flip it to "true" (or remove it) once the framework has
 * hydrated. With React, for example, flip it in a top-level component that
 * only runs client-side.
 */
export const hydrationWaiter = (options: HydrationWaiterOptions = {}): Plugin => {
  if (process.env.PWDEBUG) {
    return { name: "hydration-waiter" };
  }

  const selector = options.selector || '[data-hydrated="false"]';
  const timeout = options.timeout || 10_000;

  return {
    name: "hydration-waiter",
    middleware: async ({ page }, next) => {
      if (options.disabled) return next();

      const unhydratedLocator = page.locator(selector) as LocatorWithOriginal;
      const isUnhydrated = await unhydratedLocator.isVisible();

      if (isUnhydrated) {
        await unhydratedLocator.waitFor_original({ state: "hidden", timeout });
      }

      return next();
    },
  };
};
