/**
 * motion-waiter: don't click elements that are still sliding.
 *
 * Playwright's own actionability check only requires the target's bounding box
 * to be identical across TWO consecutive animation frames. Smooth CSS
 * transitions move every frame, so Playwright waits those out — but
 * timer-driven JS animation (React Native web's Animated, setInterval
 * steppers, legacy jQuery.animate) steps coarser than the display refresh
 * rate, so plenty of consecutive frame pairs are identical mid-slide.
 * Playwright declares the element stable and clicks it while it's still
 * moving: the click lands somewhere the user would never have aimed, and a
 * recording freezes a half-open panel at the click moment.
 *
 * This plugin samples the target's bounding box over a longer window before
 * pointer actions and proceeds only once the box holds still — a
 * technique-agnostic motion detector (CSS, WAAPI, rAF and timer steppers all
 * move the box; opacity-only fades deliberately don't engage it). The wait is
 * budgeted: perpetual motion (marquees, rotating icons) proceeds at the
 * deadline with a log line instead of blocking forever.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { ActionContext, Plugin } from "../plugin-system.ts";
import { adjustError, oneArgMethods } from "../plugin-system.ts";

export type MotionWaiterOptions = {
  /** Max time to wait for the target to stop moving (ms). Default: 1_500 */
  settleTimeout?: number;
  /** Interval between bounding-box samples (ms). Default: 60 */
  sampleInterval?: number;
  /**
   * How long the box must be observed holding still before the action
   * proceeds (ms). This is the per-action cost on static elements, and it is
   * deliberately a real window rather than a single confirming sample: an
   * element often sits parked for a frame or two before its animation starts
   * (React Native's open → requestAnimationFrame → animate shape), and it
   * also defeats step cadences slower than the sample interval. Default: 150
   */
  settledFor?: number;
  /** Movement smaller than this many px counts as still (subpixel jitter). Default: 0.5 */
  epsilon?: number;
  /** Whether to skip motion checking. Default: false */
  disabled?: boolean;
  /** Debug logging function */
  log?: (message: string) => void;
};

/** The actions where a moving target produces a mis-click or an ugly click-moment frame. */
const pointerMethods = new Set<ActionContext["method"]>(["click", "dblclick", "hover"]);

const oneArgMethodNames = new Set<string>(oneArgMethods);

const defaults: Required<MotionWaiterOptions> = {
  settleTimeout: 1_500,
  sampleInterval: 60,
  settledFor: 150,
  epsilon: 0.5,
  disabled: false,
  log: () => {},
};

/** AsyncLocalStorage for runtime settings override */
const settingsStorage = new AsyncLocalStorage<Partial<MotionWaiterOptions>>();

const getSettings = (baseOptions: MotionWaiterOptions = {}) => {
  const runtimeOverrides = settingsStorage.getStore() || {};
  const result = { ...defaults, ...baseOptions, ...runtimeOverrides };
  if (result.settleTimeout <= result.sampleInterval) {
    throw new Error("settleTimeout must be greater than sampleInterval");
  }
  return result;
};

/**
 * Creates a motion-waiter plugin.
 *
 * Runtime settings can be overridden per-test via
 * `motionWaiter.settings.enterWith({...})`, or for a single call via
 * `motionWaiter.settings.run({...}, () => locator.click())`.
 *
 * Register it INSIDE spinner-waiter (`plugins: [spinnerWaiter(),
 * motionWaiter()]`): spinner-waiter's fast-fail path passes an explicit 1ms
 * timeout down, which motion-waiter treats — like spinner-waiter itself does —
 * as the author (or an outer middleware) taking charge of timing.
 */
export const motionWaiter = Object.assign(
  (options: MotionWaiterOptions = {}): Plugin => {
    if (process.env.PWDEBUG) {
      return { name: "motion-waiter" };
    }

    return {
      name: "motion-waiter",

      middleware: async ({ args, locator, method }, next) => {
        const settings = getSettings(options);
        if (settings.disabled || !pointerMethods.has(method)) return next();

        // An explicitly passed { timeout } is the author (or an outer
        // middleware like spinner-waiter's fast-fail) saying "I own the
        // timing of this action" — same escape hatch as spinner-waiter.
        if (explicitTimeout(method, args) !== undefined) return next();

        const start = Date.now();
        const deadline = start + settings.settleTimeout;
        // The current run of identical samples: the box and when that run started.
        let still: { box: Box; since: number } | null = null;
        let sawMotion = false;

        while (Date.now() < deadline) {
          // Any boundingBox failure (strict-mode violation, closed page) is
          // next()'s to report with its own richer error.
          const box = await boundingBox(locator, settings.sampleInterval);
          const now = Date.now();
          if (box === null) {
            // Not attached/visible yet. Appearance is next()'s job, but an
            // element that appears and immediately slides in is exactly the
            // case this plugin exists for — keep sampling until the deadline.
            still = null;
            sawMotion = true;
          } else if (still !== null && sameBox(still.box, box, settings.epsilon)) {
            if (now - still.since >= settings.settledFor) {
              if (sawMotion) {
                settings.log(
                  `${locator}.${method}(...) target settled after ${now - start}ms of motion`,
                );
              }
              return next();
            }
          } else {
            if (still !== null) sawMotion = true;
            still = { box, since: now };
          }
          await sleep(settings.sampleInterval);
        }

        settings.log(
          `${locator}.${method}(...) target still moving after the ${settings.settleTimeout}ms settle budget, proceeding`,
        );
        try {
          return await next();
        } catch (error) {
          adjustError(
            error as Error,
            [
              `The target was still moving when the ${settings.settleTimeout}ms motion-settle budget ran out.`,
              `If the motion is perpetual (a marquee, a rotating icon), disable the wait for this action:`,
              `  await motionWaiter.settings.run({ disabled: true }, () => locator.${method}(...))`,
            ],
            "motion-waiter.ts",
          );
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

type Box = { x: number; y: number; width: number; height: number };

async function boundingBox(locator: ActionContext["locator"], intervalMs: number): Promise<Box | null> {
  try {
    // timeout: one quick position sample — the sampling loop owns the waiting (and spinner-waiter applies inside next()), not this read
    return await locator.boundingBox({ timeout: Math.max(intervalMs, 50) });
  } catch {
    return null;
  }
}

function sameBox(a: Box, b: Box, epsilon: number) {
  return (
    Math.abs(a.x - b.x) <= epsilon &&
    Math.abs(a.y - b.y) <= epsilon &&
    Math.abs(a.width - b.width) <= epsilon &&
    Math.abs(a.height - b.height) <= epsilon
  );
}

/** The author-passed timeout option for this action, if any. */
function explicitTimeout(method: ActionContext["method"], args: unknown[]): number | undefined {
  const options = args[oneArgMethodNames.has(method) ? 1 : 0];
  if (typeof options !== "object" || options === null || Array.isArray(options)) return undefined;
  const timeout = (options as Record<string, unknown>).timeout;
  return typeof timeout === "number" ? timeout : undefined;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
