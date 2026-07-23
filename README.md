# middlewright

A plugin/middleware system for Playwright locator actions — the one Playwright doesn't have.

Wrap `click`, `fill`, `waitFor` and friends with composable middleware, so your tests can be smart about *why* an action is slow or failing, without sprinkling `waitForSomething()` helpers through every test.

## Quick start

Install with `pnpm add -D middlewright` then wire it once in a fixture:

```ts
// test-helpers.ts
import { test as base } from "@playwright/test";
import { addPlugins, spinnerWaiter } from "middlewright";

export const test = base.extend({
  page: async ({ page: basePage }, use, testInfo) => {
    await using page = await addPlugins({
      page: basePage,
      testInfo,
      plugins: [spinnerWaiter()],
    });
    await use(page);
  },
});
```

Then write completely ordinary tests — no special helpers, no wrapper calls:

```ts
import { test } from "./test-helpers";

test("kick off a slow report", async ({ page }) => {
  await page.goto("/reports");
  await page.getByRole("button", { name: "Generate report" }).click();
  // The report takes ~20s. The app shows "generating..." while it runs, so
  // spinnerWaiter waits patiently here — but if there were NO spinner, this
  // would fail after the normal 1s actionTimeout, with a hint suggesting
  // the product add a loading state.
  await page.getByText("Report ready").click();
});
```

Pair it with an aggressive `actionTimeout` in `playwright.config.ts` (e.g. `1_000`) — the plugins are what make that viable.

For a fixture with all six plugins wired together, see the [kitchen sink](#kitchen-sink) below.

Ships with six plugins:

| Plugin | What it does | |
| --- | --- | --- |
| [`spinnerWaiter`](#spinnerwaiter) | If the app is visibly loading, wait longer for elements. If it isn't, fail fast. | [source](./src/plugins/spinner-waiter.ts) |
| [`hydrationWaiter`](#hydrationwaiter) | Don't interact with the app until it's hydrated. | [source](./src/plugins/hydration-waiter.ts) |
| [`uiErrorReporter`](#uierrorreporter) | When an action fails, append any visible error toasts to the error message. | [source](./src/plugins/ui-error-reporter.ts) |
| [`screenshot`](#screenshot) | Save and attach full-page screenshots after selected successful locator actions. | [source](./src/plugins/screenshot.ts) |
| [`videoMode`](#videomode) | Record action/dead-air facts and render watchable annotated videos after the run. | [source](./src/plugins/video-mode.ts) |
| [`llmRecover`](#llmrecover) | When an action fails, ask an LLM to write and run recovery code. Marks the test as soft-failed so nothing silently passes. | [source](./src/plugins/llm-recover.ts) |

When Playwright is launched with `--debug`, it sets `PWDEBUG=1`; the bundled plugins treat that as a hard debug-mode no-op. They still return plugin objects so your fixture can stay unchanged, but they do not wrap locator actions, wait for app state, recover failures, or write video artifacts.

`spinnerWaiter` is the best one. It makes your test pass fast, fail fast, and it incentivises agents to *improve* the product when tests fail, instead of bumping timeouts which makes tests worse and lets your product get away with bad UX.

## ⚠️ This is a hack

You should know what you're buying:

- **It patches `Locator.prototype` at runtime.** Once any page has plugins added, every locator in the process goes through the middleware dispatcher (pages without plugins fall through to the original behavior, but the patch itself is global).
- **It reaches into Playwright internals.** Clean stack traces in reports depend on `setBoxedStackPrefixes`, which is undocumented and untyped — see [microsoft/playwright#38818](https://github.com/microsoft/playwright/issues/38818) asking for it to be made official. It has *already moved once* (playwright-core ≤ 1.59: `lib/utils`; 1.60+: `lib/coreBundle`). middlewright knows both locations and degrades gracefully (with a console warning, and plugin frames in your stack traces) if a future version moves it again. Set `PLAYWRIGHT_PLUGIN_DEBUG=1` to skip stack-boxing entirely.
- **Pin your Playwright version** and treat Playwright upgrades as potentially breaking for this package. It's tested against the version in this repo's lockfile (currently 1.60.x); the declared `@playwright/test` peer range is >= 1.49.

If Playwright ever ships official action middleware, use that instead and let this package die happy.

## Why does this exist?

It started with action timeouts. A good test suite fails *fast* — a 1-second `actionTimeout` catches real bugs immediately instead of burning 30 seconds per failed assertion. But real apps have operations that legitimately take 20 seconds, and the user-facing contract for those is "show a spinner". So the timeout you actually want is conditional: **1 second normally, 30 seconds while a spinner is visible**. That also creates a nice incentive loop: if a slow operation makes a test flaky, the fix is to add a loading state to the product — which is what your users wanted anyway.

We [asked Playwright for this in 2022](https://github.com/microsoft/playwright/issues/16007). The maintainers' verdict:

> This would be tricky since it might be that spinner shows up after the action has started. \[…\] I don't think it is technically feasible.

Fair enough — *inside* Playwright's watchdog architecture it may not be. But in userland, wrapping the action with a retry-while-spinning loop is straightforward. Once you have one wrapper, you notice the pattern generalizes: waiting for hydration, surfacing error toasts, highlighting for videos, even LLM-assisted recovery are all "do something around a locator action". That's a middleware chain. This package is that middleware chain, extracted from the test infrastructure of a production app at [iterate](https://github.com/iterate).

## Plugins

### spinnerWaiter

The flagship. Before each action, if the target element isn't visible but a spinner is, waits (up to `spinnerTimeout`) for the element — bailing out early if the spinner disappears without producing it. If there's no spinner and the action fails, the error message suggests adding one:

```
Timeout 1000ms exceeded.
  If this is a slow operation, update the product code to add a spinner while it's running.
  This will improve the user experience and buy you more time for this assertion.
  To add a spinner, show any UI element matching this locator:
    locator('[aria-label="Loading"],[data-spinner=\'true\'],...')
```

```ts
spinnerWaiter({
  spinnerSelectors: ['[data-spinner="true"]'], // default also matches aria-label="Loading" and trailing "...ing..." text
  spinnerTimeout: 30_000,
});
```

Runtime overrides go through `AsyncLocalStorage` — `enterWith` for the rest of the test, `run` for a single call:

```ts
test("a test where spinners are expected to hang", async ({ page }) => {
  spinnerWaiter.settings.enterWith({ spinnerTimeout: 60_000 });
  // ...

  // or scope an override to one action:
  await spinnerWaiter.settings.run({ disabled: true }, () =>
    page.getByText("flash message").click(),
  );
});
```

### hydrationWaiter

Before each action, waits for `[data-hydrated="false"]` to disappear. Your app cooperates by rendering that attribute server-side and flipping it once the framework hydrates. Stops the classic "test clicked a button before React attached the handler" flake at the source.

```ts
hydrationWaiter({ selector: '[data-hydrated="false"]', timeout: 10_000 });
```

### uiErrorReporter

When an action fails, grabs the text of any visible error UI (default selector `[data-type="error"]`, which matches [sonner](https://sonner.emilkowal.ski/) error toasts) and appends it to the error message in red. Turns "Timeout 1000ms exceeded" into "Timeout 1000ms exceeded — Error UI visible: 'Could not save: quota exceeded'".

```ts
uiErrorReporter({ selector: '[data-type="error"]' });
```

### screenshot

Wire `screenshot()` into your fixture once, then select useful points in a flow from the command line without editing the test:

```ts
plugins: [screenshot()]
```

`PLAYWRIGHT_SCREENSHOT` is a semicolon-separated list of regular expressions matched against `locator.toString()`:

```sh
PLAYWRIGHT_SCREENSHOT='getByRole.*Save;getByText.*Published' pnpm test
```

Each matching successful action saves a full-page PNG in the test output directory and attaches it to the Playwright report. Names are readable locator slugs; repeated matches get `-2`, `-3`, and so on. Failed actions do not produce screenshots.

### videoMode

For producing demo/debugging videos people can actually follow: marks pre-action waiting as dead air, records action bounding boxes, and renders highlights/final holds into the video after the test run. Enable it conditionally (e.g. `!!process.env.VIDEO_MODE && videoMode()`) together with Playwright's `video: "on"` and a generous `actionTimeout`.

```ts
await using page = await addPlugins({
  page: basePage,
  testInfo,
  plugins: [
    videoMode({
      highlight: { mode: "pointer", duration: 1000 },
      finalHold: 3000,
      deadAirThreshold: 300,
      skipMethods: ["waitFor"],
      skipStackFrames: ["test-helpers.ts"], // don't annotate internal login/setup helpers
    }),
  ],
});

// Use page.videoMode for invisible setup/bookkeeping that should be marked as
// dead air instead of highlighted in video mode.
await page.videoMode.deadAir(async () => {
  await page.goto("/login");
  await page.locator("#email").fill("demo@example.com");
});

const videoPaths = page.videoMode.outputPaths();
const videoMetadata = await page.videoMode.metadata();
console.log(videoPaths.rendered);
console.log(videoMetadata.highlights.length);

page.videoMode.setStartTime();
await page.locator("#important-flow").click();
page.videoMode.setEndTime();
```

When Playwright video recording is enabled, `videoMode` saves `video-raw.webm`, uses `ffmpeg` to write `video-rendered.webm`, writes a sibling `video-mode.html` frame-stepper for inspecting both videos, and attaches all of them with `video-mode.json` to the test report. The frame-stepper stores its active video and frame in the URL, so links like `video-mode.html?active=rendered&frame=28` reopen the same frame. If `ffmpeg` or `ffprobe` is missing, the render step fails plainly so you know to install ffmpeg.

Chromium's native `alert`, `confirm`, and `prompt` UI is outside the page video surface. With highlighting enabled, `videoMode` observes the real Playwright dialog interaction and adds a synthetic dialog to the rendered video: the real message is readable, the chosen OK/Cancel button is held on screen, and the pointer clicks it. Accepted prompts first show a text-cursor hold over the default value, then the supplied prompt text and chosen button. The rendered video always includes at least one second after the final dialog; natural footage is left alone when it is long enough, otherwise the final clean page frame is extended. The test still handles the real Playwright `Dialog`; this only changes the rendered artifact. `beforeunload` dialogs are not synthesized.

#### Trimming the blank startup lead-in (`trimStart`)

Recording begins at browser-context creation, so a video usually opens with a few seconds of `about:blank` + loading shell before the app paints. `trimStart` finds where that lead-in ends and starts the video on real content — instead of calling `setStartTime()` by hand in every test.

```ts
videoMode({ /* trimStart: "auto" is the default */ });

// start when a known "ready" element first becomes visible (falls back to
// blank detection if it never appears):
videoMode({ trimStart: ["selector", "[data-app-ready]"] });

// pin the start for a video whose exact frames you assert on:
videoMode({ trimStart: "never" });
```

`trimStart` is one of:

- **`"auto"`** (default) — pick a sensible strategy; currently the blank detector. Chosen so consumers get lead-in trimming just by upgrading.
- **`"detect-blank"`** — decode a coarse strip of the opening seconds and find the first frame that *differs* from the opening frame (the moment the static blank lead-in ends), starting there only when the lead-in is long enough to be worth trimming. Keys on change-from-the-opening-frame, not how "busy" a frame is, so it's robust to letterbox bars and dark loading shells.
- **`["selector", css]`** — start the moment `css` first becomes visible (waited for once, live); falls back to blank detection if it never appears.
- **`"never"`** — don't trim.

An explicit `setStartTime()` always wins over `trimStart`.

`video-mode.json` records raw dead-air spans and highlight rectangles. `deadAirThreshold` is applied only when writing the rendered video: dead-air spans longer than the threshold are sped up so they render within that duration. Spans at or below the threshold are left at normal speed. `highlight` duration and `finalHold` are also applied at render time, so they do not slow down the browser test. `highlight: true` is equivalent to the default pointer mode, `{ mode: "pointer", duration: 1000 }`. For outline boxes, use a simple solid CSS-style string:

```ts
videoMode({
  highlight: { mode: "outline", style: "1px solid yellow" },
});
```

Put `spinnerWaiter` before `videoMode` when you use both. Spinner-waiter still owns spinner-specific waiting and errors, while video-mode records the preceding middleware wait as dead air and records the action target immediately before the action.

### llmRecover

The most fun one, and the most dangerous one. When an action fails, it captures a screenshot, the accessibility snapshot, the page HTML and the error, asks Claude to respond with a JavaScript recovery function, and `eval`s it with `{ page, locator, error }` in scope. Up to `maxAttempts` tries, with attempt history fed back to the model.

Two design decisions worth knowing about:

- **Recovered tests still fail.** On successful recovery it records a *soft* assertion failure, so the test keeps running (surfacing any further failures) but the run is marked failed, with the recovery code in the report. The point is to tell you *what the fix probably is* — e.g. "the button copy changed" — not to let the suite go green on vibes.
- **The LLM can decline.** If it deems the failure unrecoverable (real bug, not a locator/timing issue), the original error is rethrown with the model's explanation attached.

```ts
// gate it behind an env var — this runs LLM-generated code via eval, in
// your test process. Only enable it deliberately.
!!process.env.LLM_RECOVER && llmRecover({
  model: "claude-opus-4-8",   // default
  maxAttempts: 3,             // default
  apiKey: "...",              // default: process.env.ANTHROPIC_API_KEY
});
```

For testing (or to swap in your own agent/provider), inject `requestRecoveryCode` — see [spec/llm-recover.spec.ts](spec/llm-recover.spec.ts).

Artifacts (every attempt, code, errors, timings) are written to `<test-output-dir>/llm-recover/*.json`.

### Kitchen sink

All six plugins wired into one fixture — this mirrors how they ran in the app they were extracted from:

```ts
// test-helpers.ts
import { test as base } from "@playwright/test";
import {
  addPlugins,
  hydrationWaiter,
  llmRecover,
  screenshot,
  spinnerWaiter,
  uiErrorReporter,
  videoMode,
} from "middlewright";

export const test = base.extend({
  page: async ({ page: basePage }, use, testInfo) => {
    await using page = await addPlugins({
      page: basePage,
      testInfo,
      plugins: [
        // order matters: the first plugin is outermost. llmRecover goes first
        // so it sees errors after the other plugins have enriched them.
        !!process.env.LLM_RECOVER && llmRecover(),
        hydrationWaiter({ timeout: 60_000 }),
        uiErrorReporter(),
        spinnerWaiter(),
        screenshot(),
        // opt-in: slows everything down to make recordings watchable
        !!process.env.VIDEO_MODE && videoMode({ skipStackFrames: ["test-helpers.ts"] }),
      ],
      // also hide this helper file from stack traces in reports
      boxedStackPrefixes: (defaults) => [...defaults, import.meta.filename],
    });
    await use(page);
  },
});
```

```ts
// playwright.config.ts (the relevant bits)
export default defineConfig({
  use: {
    actionTimeout: process.env.VIDEO_MODE ? 10_000 : 1_000, // fail fast; spinnerWaiter buys time when deserved
    video: { mode: process.env.VIDEO_MODE ? "on" : "retain-on-failure" },
  },
});
```

## Writing your own plugin

**Writing your own plugins is the intended way to use this package.** The bundled five exist because they were useful for one particular app; your app has its own loading conventions, error surfaces, and flake patterns. Each bundled plugin is one small self-contained file — use them as inspiration: [spinner-waiter](./src/plugins/spinner-waiter.ts) (conditional waiting + error enrichment + runtime settings via `AsyncLocalStorage`), [hydration-waiter](./src/plugins/hydration-waiter.ts) (the simplest one — start here), [ui-error-reporter](./src/plugins/ui-error-reporter.ts) (catch/enrich/rethrow), [video-mode](./src/plugins/video-mode.ts) (video annotations/artifacts + lifecycle hooks), [llm-recover](./src/plugins/llm-recover.ts) (recovery loops, artifacts, soft assertions). The source also ships inside the npm package, so it's right there in `node_modules/middlewright/src`.

A plugin is a name plus optional `middleware`, `testLifecycle`, and `pageExtension` hooks:

```ts
import type { Plugin } from "middlewright";
import { adjustError } from "middlewright";

export const slowActionLogger = (thresholdMs = 2000): Plugin => ({
  name: "slow-action-logger",

  // Wraps every locator action. ctx has { locator, method, args, page, testInfo }.
  middleware: async (ctx, next) => {
    const start = Date.now();
    try {
      return await next(); // call the next middleware, or the real action
    } catch (error) {
      adjustError(error as Error, [`action took ${Date.now() - start}ms before failing`]);
      throw error;
    } finally {
      if (Date.now() - start > thresholdMs) {
        console.warn(`${ctx.locator}.${ctx.method}() took ${Date.now() - start}ms`);
      }
    }
  },

  // Subscribe to beforeTest/afterTest events. Return a cleanup function if needed.
  testLifecycle: (emitter) => {
    emitter.on("afterTest", ({ testInfo }) => console.log(`finished: ${testInfo.title}`));
  },
});
```

Use `pageExtension` for explicit controls tests can call through the page returned from `addPlugins`:

```ts
export const debugTools = (): Plugin<{
  debugTools: {
    title(): string;
  };
}> => ({
  name: "debug-tools",
  pageExtension: ({ testInfo }) => ({
    debugTools: {
      title: () => testInfo.title,
    },
  }),
});

await using page = await addPlugins({
  page: basePage,
  testInfo,
  plugins: [debugTools()],
});

expect(page.debugTools.title()).toBe(testInfo.title);
```

Notes for plugin authors:

- Middleware runs in registration order; the first plugin in the array is outermost. Error-enriching plugins (like `uiErrorReporter`) should generally be registered *before* the plugins whose errors they enrich, and recovery plugins (like `llmRecover`) first of all, so they see fully-enriched errors.
- Keep page extensions namespaced (`page.videoMode`, `page.debugTools`) so plugin controls do not collide with Playwright's own `Page` methods or other plugins.
- Inside middleware, use the `_original` methods (`locator.waitFor_original(...)` etc. — see the `LocatorWithOriginal` type) when you need to perform locator actions *without* re-entering the middleware chain.
- `adjustError(error, infoLines, filterFile?)` appends colored info lines to an error message and optionally scrubs your plugin's frames from the stack trace.

## How it works

`addPlugins` patches `Locator.prototype` (once per process), replacing `click`, `dblclick`, `fill`, `type`, `press`, `clear`, `blur`, `focus`, `hover` and `waitFor` with a dispatcher. The dispatcher looks up the plugin state stored on the action's page; if the page has plugins, it runs the middleware chain (each middleware calling `next()` until the original method runs); if not, it calls the original method directly.

To keep Playwright's HTML report pointing at *your test code* rather than plugin internals, it registers the plugin files with playwright-core's internal `setBoxedStackPrefixes` — the same mechanism Playwright uses to hide its own frames. This is the unofficial-API part of the hack; set `PLAYWRIGHT_PLUGIN_DEBUG=1` to disable it when debugging the plugins themselves.

## Development

```bash
pnpm install
pnpm exec playwright install chromium
pnpm test         # playwright tests (no app needed — pages are built with setContent)
pnpm typecheck
pnpm build
```

The llm-recover live-API tests are skipped unless you set `LLM_RECOVER=1` (and `ANTHROPIC_API_KEY`); provider-injected tests for the same plugin always run.

## Credits

Extracted from the internal test infrastructure of the [iterate](https://github.com/iterate) monorepo, where these plugins ran against a production app. Prior art / motivation: [microsoft/playwright#16007](https://github.com/microsoft/playwright/issues/16007), [microsoft/playwright#38818](https://github.com/microsoft/playwright/issues/38818).

## License

MIT
