/**
 * video-mode: slow down and highlight actions so recorded videos are watchable.
 *
 * Extracted from the iterate monorepo's internal Playwright test
 * infrastructure (github.com/iterate/iterate, private). Modification from the
 * original: the hardcoded skip for iterate's test-helpers file is now the
 * `skipStackFrames` option.
 */
import type { Locator } from "@playwright/test";
import type { Plugin, OverrideableMethod } from "../plugin-system.ts";

export type VideoModeOptions = {
  /** Pause duration before action (ms). Default: 1000 */
  pauseBefore?: number;
  /** Pause duration after test (ms). Default: 3000 */
  pauseAfterTest?: number;
  /** Highlight style. Default: '3px solid gold' */
  highlightStyle?: string;
  /** Methods to skip highlighting. Default: ['waitFor'] */
  skipMethods?: OverrideableMethod[];
  /**
   * Skip highlighting for actions triggered from these files (matched as
   * substrings of stack frames). Useful for internal helpers like login
   * flows that shouldn't be slowed down. Default: []
   */
  skipStackFrames?: string[];
};

/** Highlight element, pause, return disposable that unhighlights */
const setupHighlight = async (locator: Locator, style: string, pauseMs: number) => {
  try {
    await locator.evaluate((el, s) => {
      const prev = el.getAttribute("style") || "";
      el.setAttribute("data-video-prev-style", prev);
      el.setAttribute(
        "style",
        `${prev}; outline: ${s} !important; outline-offset: 2px !important;`,
      );
    }, style);
  } catch {
    // Element may not be ready yet, ignore
  }
  await new Promise((resolve) => setTimeout(resolve, pauseMs));

  return {
    [Symbol.dispose]: () => {
      // Fire-and-forget cleanup - don't wait for it
      locator
        .evaluate((el) => {
          const prev = el.getAttribute("data-video-prev-style");
          if (typeof prev === "string") {
            el.setAttribute("style", prev);
            el.removeAttribute("data-video-prev-style");
          }
        })
        .catch(() => {
          // Element may be gone or not actionable, ignore
        });
    },
  };
};

/**
 * Highlights elements before actions and pauses for video recording.
 * Also pauses after tests complete for better video endings.
 */
export const videoMode = (options: VideoModeOptions = {}): Plugin => {
  const pauseBefore = options.pauseBefore || 1000;
  const pauseAfterTest = options.pauseAfterTest || 3000;
  const highlightStyle = options.highlightStyle || "3px solid gold";
  const skipMethods = options.skipMethods || ["waitFor"];
  const skipStackFrames = options.skipStackFrames || [];

  return {
    name: "video-mode",

    middleware: async ({ locator, method }, next) => {
      if (skipMethods.includes(method)) return next();

      // Skip if called from internal helpers (navigation, login flows etc)
      if (skipStackFrames.length > 0) {
        const stack = new Error().stack || "";
        if (skipStackFrames.some((frame) => stack.includes(frame))) return next();
      }

      using _ = await setupHighlight(locator, highlightStyle, pauseBefore);
      return await next();
    },

    testLifecycle: (emitter) => {
      return emitter.on("afterTest", async ({ testInfo }) => {
        await new Promise((resolve) => setTimeout(resolve, pauseAfterTest));
        console.log(`video will be written to ${testInfo.outputDir}/video.webm`);
      });
    },
  };
};
