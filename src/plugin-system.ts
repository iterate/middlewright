/**
 * middlewright plugin system.
 *
 * Extracted from the iterate monorepo's internal Playwright test
 * infrastructure (github.com/iterate/iterate, private). Modifications from the
 * original: playwright-core internals are resolved relative to
 * `@playwright/test` so this works under pnpm's strict node_modules layout,
 * and locator actions on pages that never had plugins added fall through to
 * the original implementation instead of throwing.
 */
import { createRequire } from "node:module";
import * as path from "node:path";
import Emittery from "emittery";
import type { Locator, Page, TestInfo } from "@playwright/test";

const require = createRequire(import.meta.url);

// Methods that take an extra argument before options (e.g., fill(value, options))
const oneArgMethods = ["fill", "type", "press"] as const;
type OneArgMethod = (typeof oneArgMethods)[number];

const overrideableMethods = [
  "click",
  "waitFor",
  "clear",
  "dblclick",
  "blur",
  "focus",
  "hover",
  ...oneArgMethods,
] satisfies (keyof Locator)[];
type OverrideableMethod = (typeof overrideableMethods)[number];

export type LocatorWithOriginal = Locator & {
  [K in OverrideableMethod as `${K}_original`]: Locator[K];
};

/**
 * Append info to an error message and clean up stack trace.
 * @param error - The error to modify
 * @param info - Lines to append to the error message
 * @param filterFile - Filename to remove from stack trace (e.g., "my-plugin.ts")
 * @param color - ANSI color code (default: 33 = yellow). Use 31 for red.
 */
export const adjustError = (
  error: Error,
  info: string[],
  filterFile?: string,
  { color = 33 } = {},
) => {
  if (!error?.message) return;

  Object.assign(error, { originalMessage: error.message, originalStack: error.stack });

  if (info.length > 0) {
    const infoBlock = info.map((line) => `  ${line}`).join("\n");
    error.message = `${error.message}\n\x1b[${color}m${infoBlock}\x1b[0m\n`;
  }

  if (filterFile && error.stack) {
    error.stack = error.stack
      .split("\n")
      .filter((line) => !line.includes(filterFile))
      .join("\n");
  }
};

export type ActionContext = {
  locator: LocatorWithOriginal;
  method: OverrideableMethod;
  args: unknown[];
  page: Page;
  testInfo: TestInfo;
  timing: ActionTiming;
};

export type ActionMiddlewareTiming = {
  name: string;
  startedAt: number;
  endedAt?: number;
};

export type ActionTiming = {
  actionStartedAt: number;
  attachedAt?: number;
  attachedAtStart: boolean;
  middlewares: ActionMiddlewareTiming[];
  /**
   * `performance.now()` spans a middleware flags as watchable footage — a
   * settle wait spanning a real on-screen animation, say. Video renderers
   * keep these at full speed instead of compressing them as dead air.
   */
  watchableSpans: { startedAt: number; endedAt: number }[];
};

/** Function that calls the next middleware or the original action */
export type NextFn = (args?: unknown[]) => Promise<unknown>;

/** Middleware function - wraps an action, must call next() */
export type ActionMiddleware = (ctx: ActionContext, next: NextFn) => Promise<unknown>;

export type TestLifecycleEvents = {
  beforeTest: { page: Page; testInfo: TestInfo };
  afterTest: { page: Page; testInfo: TestInfo };
  afterTestFinalize: { page: Page; testInfo: TestInfo };
};

export type PageExtensionContext = {
  page: Page;
  testInfo: TestInfo;
};

export type PopupPluginContext = {
  /** The newly opened popup page, not yet wrapped. */
  page: Page;
  /** The wrapped page that opened the popup. */
  parentPage: Page;
  testInfo: TestInfo;
};

export type Plugin<PageExtension extends object = {}> = {
  name: string;
  /** Middleware to wrap locator actions. Called in registration order. */
  middleware?: ActionMiddleware;
  /** Subscribe to test lifecycle events */
  testLifecycle?: (emitter: Emittery<TestLifecycleEvents>) => void | (() => void);
  /** Add explicit test controls to the page returned from addPlugins. */
  pageExtension?: (ctx: PageExtensionContext) => PageExtension;
  /**
   * Called when a page wrapped with this plugin opens a popup, to produce the
   * plugin registered on the popup — often a fresh instance tied to this one.
   * Return null to skip this plugin on popups. Plugins without this hook are
   * re-registered as-is (fine for stateless plugins).
   */
  forPopup?: (ctx: PopupPluginContext) => Plugin<object> | false | null | undefined;
};

const PLUGIN_STATE = Symbol("playwrightPluginState");

type PluginState = {
  actionMiddlewares: RegisteredActionMiddleware[];
  lifecycleEmitter: Emittery<TestLifecycleEvents>;
  lifecycleCleanups: (() => void)[];
  testInfo: TestInfo;
};

type RegisteredActionMiddleware = {
  name: string;
  middleware: ActionMiddleware;
};

type MaybePlugin = Plugin<object> | false | null | undefined;

type PluginPageExtension<T> = T extends Plugin<infer PageExtension> ? PageExtension : {};

type PluginPageExtensionForEntry<T> = [Extract<T, Plugin<object>>] extends [never]
  ? {}
  : [Exclude<T, Plugin<object>>] extends [never]
    ? PluginPageExtension<T>
    : Partial<PluginPageExtension<T>>;

type UnionToIntersection<T> = (T extends unknown ? (value: T) => void : never) extends (
  value: infer Intersection,
) => void
  ? Intersection
  : never;

type PageExtensions<T extends readonly MaybePlugin[]> = UnionToIntersection<
  {
    [Index in keyof T]: PluginPageExtensionForEntry<T[Index]>;
  }[number]
> &
  object;

type PageWithPlugins<PageExtension extends object = {}> = Page & PageExtension & {
  [PLUGIN_STATE]: PluginState;
  [Symbol.asyncDispose]: () => Promise<void>;
};

// Track if Locator prototype has been patched
let prototypePatched = false;

/** Get plugin state from a page */
const getPluginState = (page: Page): PluginState | undefined => {
  return (page as PageWithPlugins)[PLUGIN_STATE];
};

/**
 * Add plugins to a page. Returns a disposable page that cleans up on dispose.
 *
 * @example
 * ```ts
 * await using page = await addPlugins({
 *   page: basePage,
 *   testInfo,
 *   plugins: [
 *     hydrationWaiter(),
 *     spinnerWaiter(),
 *     videoMode(),
 *   ]
 * });
 * ```
 */
export const addPlugins = async <const Plugins extends readonly MaybePlugin[]>(params: {
  page: Page;
  testInfo: TestInfo;
  plugins: Plugins;
  /**
   * Automatically add plugins to popups this page opens (and to their popups,
   * recursively). Plugins may define `forPopup` to control or skip what gets
   * registered on the popup. Default: true. Pass false to leave popups
   * unwrapped — they fall through to original Playwright behavior and can be
   * wrapped manually with fresh plugin instances.
   */
  popups?: boolean;
  boxedStackPrefixes?: (defaults: string[]) => string[];
}): Promise<PageWithPlugins<PageExtensions<Plugins>>> => {
  const { page, testInfo, plugins, boxedStackPrefixes } = params;
  if (getPluginState(page)) {
    throw new Error(
      "this page already has plugins added. Popups are auto-wrapped by default - " +
        "pass popups: false to the parent addPlugins call for manual control, " +
        "and use fresh plugin instances for each page",
    );
  }
  // Patch Locator prototype once globally
  patchLocatorPrototype(page, boxedStackPrefixes);

  // Initialize state on page
  const state: PluginState = {
    actionMiddlewares: [],
    lifecycleEmitter: new Emittery(),
    lifecycleCleanups: [],
    testInfo,
  };

  // Register plugins
  for (const plugin of plugins) {
    if (!plugin) continue;

    if (plugin.middleware) {
      state.actionMiddlewares.push({
        middleware: plugin.middleware,
        name: plugin.name,
      });
    }

    if (plugin.testLifecycle) {
      const cleanup = plugin.testLifecycle(state.lifecycleEmitter);
      if (cleanup) state.lifecycleCleanups.push(cleanup);
    }
  }

  const pageWithPlugins = page as PageWithPlugins<PageExtensions<Plugins>>;
  pageWithPlugins[PLUGIN_STATE] = state;

  for (const plugin of plugins) {
    if (!plugin) continue;
    if (!plugin.pageExtension) continue;

    Object.assign(pageWithPlugins, plugin.pageExtension({ page, testInfo }));
  }

  // Emit beforeTest
  await state.lifecycleEmitter.emitSerial("beforeTest", { page, testInfo });

  // Auto-wrap popups (default on). The child addPlugins call attaches plugin
  // state synchronously in the tick the popup event fires — before test code
  // awaiting waitForEvent("popup") gets to act on the popup — because this
  // listener is registered ahead of the test's own.
  const childWraps: Promise<PageWithPlugins>[] = [];
  let onPopup: ((popup: Page) => void) | undefined;
  if (params.popups !== false) {
    onPopup = (popupPage) => {
      const childPlugins = plugins
        .filter((plugin): plugin is Plugin<object> => !!plugin)
        .map((plugin) =>
          plugin.forPopup
            ? plugin.forPopup({ page: popupPage, parentPage: page, testInfo })
            : plugin,
        );
      const wrap = addPlugins({ page: popupPage, testInfo, plugins: childPlugins });
      childWraps.push(wrap);
      // Failures surface at dispose; avoid unhandled-rejection noise meanwhile.
      wrap.catch(() => {});
    };
    page.on("popup", onPopup);
  }

  // Add async dispose
  pageWithPlugins[Symbol.asyncDispose] = async () => {
    if (onPopup) {
      page.off("popup", onPopup);
    }
    // Children dispose first (newest first) so their plugins can finalize --
    // and feed facts to parent plugins -- before the parent's own lifecycle
    // events run. A failed child wrap OR a throwing child dispose must not
    // stop the parent finalizing (that would drop the main page's artifacts);
    // failures rethrow below once the parent's own teardown has run.
    const childFailures: unknown[] = [];
    const settledChildren = await Promise.allSettled(childWraps);
    for (const result of [...settledChildren].reverse()) {
      if (result.status === "rejected") {
        childFailures.push(result.reason);
        continue;
      }
      try {
        await result.value[Symbol.asyncDispose]();
      } catch (error) {
        childFailures.push(error);
      }
    }
    await state.lifecycleEmitter.emitSerial("afterTest", { page, testInfo });
    await state.lifecycleEmitter.emitSerial("afterTestFinalize", { page, testInfo });
    state.lifecycleCleanups.forEach((cleanup) => cleanup());
    if (childFailures.length > 0) {
      throw childFailures[0];
    }
  };

  return pageWithPlugins;
};

/**
 * Resolve playwright-core starting from @playwright/test. Under pnpm's strict
 * layout, playwright-core isn't reachable from this package - only via the
 * host project's @playwright/test.
 */
const resolvePlaywrightInternals = () => {
  const testPkg = require.resolve("@playwright/test/package.json");
  const requireFromTest = createRequire(testPkg);
  const playwrightPkg = requireFromTest.resolve("playwright/package.json");
  const corePkg = createRequire(playwrightPkg).resolve("playwright-core/package.json");
  return { testPkg, playwrightPkg, corePkg };
};

/**
 * setBoxedStackPrefixes is an internal playwright-core API
 * (https://github.com/microsoft/playwright/issues/38818 asks for it to be made
 * official) and has already moved once: playwright-core <= 1.59 exposed it
 * from lib/utils, 1.60+ from the utils namespace of lib/coreBundle. Returns
 * null when it can't be found - everything works without it, you just see
 * plugin frames in stack traces.
 */
const loadSetBoxedStackPrefixes = (corePkg: string): ((prefixes: string[]) => void) | null => {
  const coreRequire = createRequire(corePkg);
  for (const load of [
    () => coreRequire("./lib/utils").setBoxedStackPrefixes,
    () => coreRequire("./lib/coreBundle").utils.setBoxedStackPrefixes,
  ]) {
    try {
      const fn = load();
      if (typeof fn === "function") return fn;
    } catch {
      // try the next layout
    }
  }
  return null;
};

const locatorIsAttached = async (locator: Locator) => {
  try {
    return (await locator.count()) > 0;
  } catch {
    return false;
  }
};

const observeAttachedAt = (
  locator: Locator,
  timing: ActionTiming,
  pollIntervalMs = 50,
) => {
  let stopped = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const poll = async () => {
    if (stopped || timing.attachedAt !== undefined) {
      return;
    }

    const attached = await locatorIsAttached(locator);
    if (stopped || timing.attachedAt !== undefined) {
      return;
    }

    if (attached) {
      timing.attachedAt = performance.now();
      return;
    }

    timeout = setTimeout(() => {
      void poll();
    }, pollIntervalMs);
  };

  void poll();

  return () => {
    stopped = true;
    if (timeout) {
      clearTimeout(timeout);
    }
  };
};

/** Patch Locator prototype to run middleware. Safe to call multiple times. */
const patchLocatorPrototype = (
  page: Page,
  boxedStackPrefixes?: (defaults: string[]) => string[],
) => {
  if (prototypePatched) return;
  prototypePatched = true;

  const internals = resolvePlaywrightInternals();

  // Exclude this file from stack traces in Playwright reports
  if (!process.env.PLAYWRIGHT_PLUGIN_DEBUG) {
    const setBoxedStackPrefixes = loadSetBoxedStackPrefixes(internals.corePkg);
    if (setBoxedStackPrefixes) {
      const getPrefixes = boxedStackPrefixes || ((defaults) => defaults);
      const prefixes = getPrefixes([
        path.dirname(internals.testPkg),
        path.dirname(internals.playwrightPkg),
        path.dirname(internals.corePkg),
        import.meta.filename,
      ]);
      setBoxedStackPrefixes(prefixes);
    } else {
      console.warn(
        "[middlewright] could not find setBoxedStackPrefixes in this playwright-core version - " +
          "stack traces in reports will include plugin frames",
      );
    }
  }

  const dummyLocator = page.locator("body");
  const locatorPrototype = dummyLocator.constructor.prototype;

  for (const method of overrideableMethods) {
    locatorPrototype[`${method}_original`] = locatorPrototype[method];

    const value = async function patchedMethod(
      this: LocatorWithOriginal,
      ...args: unknown[]
    ): Promise<unknown> {
      let currentArgs = args;
      const callOriginal = () => (this[`${method}_original`] as Function)(...currentArgs);

      // Pages that never had plugins added (e.g. a second page in the same
      // worker) fall through to the original implementation.
      const state = getPluginState(this.page());
      if (!state) return callOriginal();
      const actionMiddlewares = state.actionMiddlewares;
      const actionStartedAt = performance.now();
      const attachedAtStart = await locatorIsAttached(this);
      const timing: ActionTiming = {
        actionStartedAt,
        attachedAt: attachedAtStart ? actionStartedAt : undefined,
        attachedAtStart,
        middlewares: [],
        watchableSpans: [],
      };
      const stopObservingAttached = attachedAtStart
        ? () => {}
        : observeAttachedAt(this, timing);

      const ctx: ActionContext = {
        locator: this,
        method,
        args,
        page: this.page(),
        testInfo: state.testInfo,
        timing,
      };

      // Build middleware chain - each middleware calls next() to continue
      let index = 0;
      const next: NextFn = async (nextArgs) => {
        if (nextArgs) {
          currentArgs = nextArgs;
          ctx.args = nextArgs;
        }

        if (index < actionMiddlewares.length) {
          const { middleware, name } = actionMiddlewares[index++];
          const middlewareTiming: ActionMiddlewareTiming = {
            name,
            startedAt: performance.now(),
          };
          timing.middlewares.push(middlewareTiming);
          try {
            return await middleware(ctx, next);
          } finally {
            middlewareTiming.endedAt = performance.now();
          }
        }
        return callOriginal();
      };

      try {
        return await next();
      } finally {
        stopObservingAttached();
      }
    };

    Object.defineProperty(locatorPrototype, method, { value });
  }
};

// Re-export types for plugin authors
export type { OverrideableMethod, OneArgMethod };
export { oneArgMethods, overrideableMethods };
