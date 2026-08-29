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

### Don't fix slow tests with longer timeouts

An explicit action timeout makes a test wait longer whether the app is working or stuck. Keep Playwright's `actionTimeout` short so broken tests fail fast. If a real operation is slow, give users loading UI and let `spinnerWaiter` extend the wait only while that progress is visible.

When a timeout looks necessary:

1. Fix the slow product behavior if practical.
2. Otherwise add visible loading UI that `spinnerWaiter` can detect.
3. Keep an explicit timeout only when a product or Middlewright limit makes spinner-based waiting impossible. Explain that exact limit beside the timeout.

### Prefer positive waits over absence

An element disappearing proves only that it is gone. The intended action may have succeeded, but the app may instead have navigated to an error page, crashed, or rendered the wrong empty state. Wait for UI that identifies the outcome:

```ts
// Ambiguous: Florence could be absent for many reasons.
await page.getByText("Florence").waitFor({ state: "detached" });

// Positive evidence for the intended empty result.
await page.getByText("No results found").waitFor();
```

If the product has no result, empty, loading, or error UI that a test can observe, add it. That state helps users understand what happened and gives the test a useful product contract.

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

### motionWaiter

Waits for a *moving* target to settle before pointer actions (`click`, `dblclick`, `hover`). Playwright's own stability check only compares the target's bounding box across two consecutive frames, so timer-driven JS animation (React Native web's `Animated`, `setInterval` steppers) that steps coarser than the display refresh gets clicked mid-slide — the click lands on a half-open drawer, and video-mode's click-moment freeze bakes the clipped panel into the recording.

motionWaiter samples the target's bounding box over a longer window: a static element passes after one confirming sample (~60ms), but once motion is observed the box must hold still for `settledFor` before the action proceeds. The wait is budgeted — perpetual motion (marquees, rotating icons) proceeds at `settleTimeout` with a log line instead of blocking. Opacity-only fades never engage it (the box doesn't move), and step cadences slower than `sampleInterval` can pass the initial check, same as vanilla Playwright.

```ts
motionWaiter({
  settleTimeout: 1_500, // max wait for motion to stop
  sampleInterval: 60, // ms between bounding-box samples
  settledFor: 150, // quiet window required once motion was seen
});
```

Register it after `spinnerWaiter` (`plugins: [spinnerWaiter(), motionWaiter()]`): spinner-waiter's fast-fail path passes an explicit 1ms timeout inward, and motionWaiter — like spinnerWaiter itself — treats an explicit `{ timeout }` as the author taking charge of timing and passes straight through. The same `settings.enterWith` / `settings.run` runtime overrides apply:

```ts
await motionWaiter.settings.run({ disabled: true }, () =>
  page.getByText("stock ticker").click(),
);
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
  plugins: [videoMode()],
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

By default, `videoMode` burns Playwright `test.step` titles into the rendered video:

```ts
await test.step("Create an account", async () => {
  await page.getByText("Create").click();
  await page.getByText("Hooray").click();
});
```

Use `captions: "explicit"` to ignore `test.step` and caption only chosen spans. The helper is also available in the default mode.

```ts
videoMode({ captions: "explicit" });

await page.videoMode.caption("Create an account", async () => {
  await page.getByText("Create").click();
  await page.getByText("Hooray").click();
});
```

Nested spans show the innermost caption, then resume their parent. When Playwright video recording is enabled, `videoMode` saves untouched `video-raw.webm`, uses `ffmpeg` to write annotated `video-rendered.webm`, writes a sibling `video-mode.html` frame-stepper for inspecting both videos, and attaches all of them with `video-mode.json` to the test report. Caption and address-bar spans are recorded in `video-mode.json` and stay aligned through trimming, dead-air compression, and synthetic action holds. The frame-stepper stores its active video and frame in the URL, so links like `video-mode.html?active=rendered&frame=28` reopen the same frame. If `ffmpeg` or `ffprobe` is missing, the render step fails plainly so you know to install ffmpeg.

Each successful `page.goto()` records the resolved destination in `addressBars` metadata. During post-rendering, ffmpeg adds a Chrome-style URL bar over a frozen destination frame and reveals the URL one whole glyph at a time; the default hold is 1000ms. Long destinations use compact, single-line type clipped to the address field. The live page and `video-raw.webm` stay untouched, and navigation returns without waiting for the hold. Set `addressBar: { holdMs: 2000 }` to keep the rendered bar readable for longer, or `addressBar: false` to disable it.

Highlighted non-empty `fill()` actions pause on the empty field, then reveal the completed text one whole glyph at a time during the rendered hold. The browser still runs one normal Playwright `fill()`; video mode captures the final field pixels and adds the typewriter-like effect in post, preserving backgrounds such as gradients. The surrounding frame stays at its pre-action state, and an opaque field background covers placeholder text before the value appears. Pointer highlights first move to the field and change to a text cursor; outline highlights use the same pre-reveal pause without a synthetic pointer.

The field rectangle is stabilized from its pre-action screenshot across the recorder-to-hold boundary, and raw footage resumes only after the post-action screenshot. This prevents recorder-delayed frames from briefly leaking the completed value before the hold or restoring the placeholder after the reveal.

Stable, non-scrolling inputs and textareas use measured glyph stops. Scrolling and multiline textareas reveal the final visible crop one visible line at a time, using the field's line height rather than reconstructing browser text layout. A vertically scrolled value can therefore begin partway through a line. Horizontally scrolled inputs keep a single left-to-right reveal band. Resized textareas hold at their initial geometry, then switch to their final geometry and an assumed solid background when the reveal begins. Password, right-to-left, unusually long, and fields without a usable background still fall back to a stable post-fill highlight.

Chromium's native `alert`, `confirm`, and `prompt` UI is outside the page video surface. With highlighting enabled, `videoMode` observes the real Playwright dialog interaction and draws a synthetic dialog entirely with ASS during post-production: the application page is never patched or given dialog DOM. The renderer freezes the clean application frame from immediately before the dialog opened, shows the real message, and holds the chosen OK/Cancel button while the pointer clicks it. Accepted prompts first show a text-cursor hold over the default value, reveal the supplied prompt text one whole glyph at a time, then select the chosen button. The rendered video always includes at least one second after the final dialog; natural footage is left alone when it is long enough, otherwise the final clean page frame is extended. The test still handles the real Playwright `Dialog`; this only changes the rendered artifact. `beforeunload` dialogs are not synthesized.

#### Choosing where the rendered video starts (`trimStart`)

Recording begins at browser-context creation. By default, `videoMode` trims setup footage before the first locator action, including calls to `waitFor()`, `click()`, and `fill()`. The action's Playwright auto-wait stays in the clip.

```ts
const video = videoMode(); // trimStart: "auto" is the default
await using page = await addPlugins({ page: basePage, testInfo, plugins: [video] });

// The rendered video starts here, including this click's auto-wait.
await page.getByRole("button", { name: "Create report" }).click();

// start when a known "ready" element first becomes visible (falls back to
// blank detection if it never appears):
videoMode({ trimStart: ["selector", "[data-app-ready]"] });

// pin the start for a video whose exact frames you assert on:
videoMode({ trimStart: "never" });
```

`trimStart` is one of:

- **`"auto"`** (default) — start when the first locator method is invoked. If no locator is used, keep the natural recorder start.
- **`"detect-blank"`** — decode a coarse strip of the opening seconds and find the first frame that *differs* from the opening frame (the moment the static blank lead-in ends), starting there only when the lead-in is long enough to be worth trimming. Keys on change-from-the-opening-frame, not how "busy" a frame is, so it's robust to letterbox bars and dark loading shells.
- **`["selector", css]`** — start the moment `css` first becomes visible (waited for once, live); falls back to blank detection if it never appears.
- **`"never"`** — don't trim.

An explicit `setStartTime()` always wins over `trimStart`.

`videoMode()` uses review-friendly pacing by default: dead-air spans are compressed to at most 300ms, pointer highlights hold for 1000ms, and the final frame holds for 1000ms. `video-mode.json` records raw dead-air spans and highlight rectangles. `deadAirThreshold` is applied only when writing the rendered video: dead-air spans longer than the threshold are sped up so they render within that duration. Spans at or below the threshold are left at normal speed. `highlight` duration and `finalHold` are also applied at render time, so they do not slow down the browser test. The final hold uses the last live page frame instead of extending recorder shutdown frames. `highlight: true` is equivalent to the default pointer mode, `{ mode: "pointer", duration: 1000 }`. For outline boxes, use a simple solid CSS-style string:

```ts
videoMode({
  highlight: { mode: "outline", style: "1px solid yellow" },
});
```

A successful visible `locator.waitFor()` points at and holds the resolved locator using the same highlight mode and duration. The elapsed wait remains dead air, so `deadAirThreshold` can compress it before the resolved-state hold. Use `skipMethods: ["waitFor"]` to keep waits as dead air without highlighting their result.

#### Panning to offscreen elements

When a highlighted target sits outside the viewport, the rendered video pans to it. The live page is never scrolled: at highlight time video mode captures a beyond-viewport screenshot (Chromium renders offscreen content without scrolling — no scroll event fires, scroll position is untouched, and IntersectionObservers never see the element), and the renderer animates a smooth camera travel over that still. A `waitFor()` pans to the element, holds the highlight, and pans back, since the real page never moved. Actions like `click()` pan and stay: Playwright scrolls the live page as part of the action, and the pan lands exactly where the post-action footage resumes, replacing the instant scroll jump with a readable travel. `fill()` keeps its reveal pipeline unpanned.

Known limitations: the pan is a frozen still, so page animations pause during the travel, and `position: fixed`/`sticky` elements slide with the content instead of staying pinned. Elements hidden inside a scrollable container (not the window) keep plain highlighting, since window scrolling could not reveal them. Chromium leaks one zoomed-out frame into the raw screencast while capturing beyond the viewport; the renderer consumes that span so it never appears in the rendered video, and the page observes only a no-op `resize` event with unchanged dimensions.

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

### Popups

Popups are wrapped automatically. When a wrapped page opens one — an OAuth window, say — the popup gets the same plugin treatment, no wiring:

```ts
const popupPromise = page.waitForEvent("popup");
await page.getByRole("button", { name: "Sign in" }).click();
const popup = await popupPromise; // already wrapped
await popup.getByRole("button", { name: "Approve" }).click();
```

In video mode, the popup renders as an overlay **in the main page's video**: scaled to fit 90% of the frame over the dimmed page, faded in and out on open/close, with popup clicks pointer-annotated inside the overlay. One composed video per test, popups included. The popup's facts land in `video-mode.json` under `children`.

Details and escape hatches:

- Plugins can control what a popup gets via the `forPopup(ctx)` hook — return a plugin for the popup, or `null` to skip. Hookless plugins are re-registered as-is (fine for stateless ones).
- `addPlugins({ ..., popups: false })` turns auto-wrap off. You can then wrap the popup manually with **fresh plugin instances** — a fresh `videoMode()` gives the popup its own standalone video, with `-2`-suffixed artifacts (`video-rendered-2.webm`, `video-mode-2.json`, …).
- Wrapping an already-wrapped page throws, as does reusing an active `videoMode` instance on a second page — one instance per page.
- Popup dialogs (`alert`/`confirm`/`prompt` opened by the popup) aren't annotated in video mode yet.

See [spec/popup.spec.ts](spec/popup.spec.ts) and [spec/popup-overlay-demo.spec.ts](spec/popup-overlay-demo.spec.ts).

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

## Oxlint plugin

Middlewright ships a zero-dependency Oxlint plugin at `middlewright/lint-plugin`. Enable it in `.oxlintrc.json`:

```json
{
  "jsPlugins": ["middlewright/lint-plugin"],
  "rules": {
    "middlewright/prefer-locator-waits": "error",
    "middlewright/prefer-positive-waits": "error",
    "middlewright/require-timeout-comment": "error"
  }
}
```

`middlewright/prefer-locator-waits` replaces redundant Playwright locator assertions with locator-native waits:

```ts
await expect(page.getByText("Ready")).toBeVisible();
await expect(page.getByRole("status")).toContainText("Receipt ready");

// oxlint --fix
await page.getByText("Ready").waitFor();
await page.getByRole("status").filter({ hasText: "Receipt ready" }).waitFor();
```

`middlewright/prefer-positive-waits` reports `.waitFor({ state: "detached" })`. Prefer explicit
result, empty-state, or error UI; see [Prefer positive waits over absence](#prefer-positive-waits-over-absence).
An exceptional detached wait needs a nearby `//` comment matching `detached`, case-insensitively:

```ts
await page.getByText("Florence").waitFor({ state: "detached" }); // lint error

// detached is the only completion signal exposed by this browser-owned element
await page.getByText("Exporting").waitFor({ state: "detached" });
```

Override the required case-insensitive regex sources when a project needs stronger exception
comments. Every configured pattern must match the nearby comment:

```json
{
  "rules": {
    "middlewright/prefer-positive-waits": [
      "error",
      { "requiredPatterns": ["detached", "browser.?owned"] }
    ]
  }
}
```

`middlewright/require-timeout-comment` requires every explicit timeout option on a method call
to have a nearby `//` comment matching both `timeout` and `spinner.?waiter`, case-insensitively.
This forces the exception to say why [`spinnerWaiter`](#dont-fix-slow-tests-with-longer-timeouts)
cannot replace the timeout. The comment can trail the call or appear on the line immediately
before the call. Multiline options can put it beside the timeout property instead. The rule does
not autofix because it cannot invent the reason.

```ts
await page.getByText("Export").click({ timeout: 30_000 }); // lint error

// timeout is needed because the third-party export exposes no state for spinner waiter
await page.getByText("Export").click({ timeout: 30_000 });
```

Override the required case-insensitive regex sources when your loading convention differs. Every
configured pattern must match the nearby comment:

```json
{
  "rules": {
    "middlewright/require-timeout-comment": [
      "error",
      { "requiredPatterns": ["timeout", "loading.?ui"] }
    ]
  }
}
```

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
