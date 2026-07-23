/**
 * Backported from iterate/iterate#2080's Playwright screenshot helper.
 * Modifications: exported as a middlewright plugin and made self-contained by
 * replacing Iterate's private slugify dependency with the local helper below.
 */
import type { TestInfo } from "@playwright/test";
import type { Plugin } from "../plugin-system.ts";

const ENVIRONMENT_VARIABLE = "PLAYWRIGHT_SCREENSHOT";
const occurrencesByTest = new WeakMap<TestInfo, Map<string, number>>();

/**
 * Captures a full-page screenshot after each successful locator action whose
 * description matches PLAYWRIGHT_SCREENSHOT.
 *
 * Set the environment variable to semicolon-separated regular expressions
 * matched against locator.toString().
 */
export const screenshot = (): Plugin => {
  const matchers = parseMatchers(process.env[ENVIRONMENT_VARIABLE] || "");

  if (matchers.length === 0 || process.env.PWDEBUG) {
    return { name: "screenshot" };
  }

  return {
    name: "screenshot",
    middleware: async (context, next) => {
      const locatorDescription = context.locator.toString();
      const matches = matchers.some((matcher) => matcher.test(locatorDescription));
      const result = await next();

      if (matches) {
        const occurrences = occurrencesByTest.get(context.testInfo) || new Map<string, number>();
        occurrencesByTest.set(context.testInfo, occurrences);
        const locatorSlug = slugify(locatorDescription);
        const occurrence = (occurrences.get(locatorSlug) || 0) + 1;
        occurrences.set(locatorSlug, occurrence);
        const screenshotSlug = occurrence === 1 ? locatorSlug : `${locatorSlug}-${occurrence}`;
        const path = context.testInfo.outputPath(`${screenshotSlug}.png`);
        await context.page.screenshot({ fullPage: true, path });
        await context.testInfo.attach(screenshotSlug, { contentType: "image/png", path });
      }

      return result;
    },
  };
};

const parseMatchers = (value: string) =>
  value
    .split(";")
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .map((pattern, index) => {
      try {
        return new RegExp(pattern);
      } catch (error) {
        throw new Error(
          `Invalid ${ENVIRONMENT_VARIABLE} regex at position ${index + 1}: ${pattern}`,
          { cause: error },
        );
      }
    });

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160)
    .replace(/-+$/g, "") || "locator";
