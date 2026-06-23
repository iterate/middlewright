/**
 * ui-error-reporter: when an action fails, tell me what the app was screaming about.
 *
 * Extracted from the iterate monorepo's internal Playwright test
 * infrastructure (github.com/iterate/iterate, private).
 */
import type { Plugin } from "../plugin-system.ts";
import { adjustError } from "../plugin-system.ts";

export type UIErrorReporterOptions = {
  /**
   * Selector for error UI. Default: '[data-type="error"]' (which matches
   * sonner error toasts, among others).
   */
  selector?: string;
};

/**
 * When a locator action fails, checks for visible error toasts/other UI and appends
 * their text to the error message for easier debugging.
 */
export const uiErrorReporter = (options: UIErrorReporterOptions = {}): Plugin => {
  if (process.env.PWDEBUG) {
    return { name: "ui-error-reporter" };
  }

  const selector = options.selector || '[data-type="error"]';

  return {
    name: "ui-error-reporter",

    middleware: async ({ page }, next) => {
      try {
        return await next();
      } catch (error) {
        const getToastErrors = () => page.locator(selector).allTextContents();
        const messages = await getToastErrors().catch(() => []);

        if (messages.length > 0 && error instanceof Error) {
          const info = [`Error UI visible:`, ...messages.map((m) => JSON.stringify(m.trim()))];
          adjustError(error, info, import.meta.filename, { color: 31 });
        }

        throw error;
      }
    },
  };
};
