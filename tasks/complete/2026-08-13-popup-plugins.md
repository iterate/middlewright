---
status: done
size: medium
branch: popup-plugins
pr: https://github.com/iterate/middlewright/pull/32
---

# Popup support (auth popout windows)

**Status summary**: done. Middleware plugins supported popups all along via a second `addPlugins` call; video mode now supports them too — each `videoMode()` instance gets its own artifact namespace (auto `-2` suffix for the second instance in a test), and reusing one instance across pages throws a clear error. Specs cover metadata isolation, the guard, and real `video: "on"` recording. README has a Popups section.

The pattern this supports:

```ts
const popupPromise = page.waitForEvent("popup");
await page.getByRole("button", { name: "Sign in" }).click();
await using popup = await addPlugins({
  page: await popupPromise,
  testInfo,
  plugins: [spinnerWaiter(), videoMode()], // fresh instances for the popup
});
```

## Findings: do we need a code change?

- **Middleware plugins (spinnerWaiter, hydrationWaiter, uiErrorReporter, screenshot): no.** The `Locator.prototype` patch is global, but dispatch is per-page via `getPluginState(this.page())` (`src/plugin-system.ts`). An unwrapped popup falls through to original Playwright behavior; a second `addPlugins` call on the popup gives it its own plugin state. This is the designed seam.
- **videoMode: yes.** Two hazards, one per way you might wire it:
  1. **Reusing the same `videoMode()` instance** on page + popup was broken: the plugin holds one per-test `state` closure, and its `beforeTest` handler resets it — wrapping the popup mid-test wiped the main page's timeline. Now guarded: registering an active instance on a second page throws "create a fresh videoMode() instance for each page".
  2. **A fresh `videoMode()` instance per popup** is the right model (Playwright screencasts each page separately; the instance's timebase is its creation time ≈ popup screencast start). Artifact filenames used to be fixed per `testInfo.outputDir` so the two instances clobbered each other; now each registration in a test gets a suffix (first instance unsuffixed for back-compat, then `-2`, `-3`, …) applied to metadata, raw/rendered video, player HTML, highlight/pan/fill images, dialog/final frames, `.ass` files, and attachment names.
- A single combined video (main page + popup interleaved) would require compositing two screencasts and stays out of scope. Separate videos per page is the natural model.

## Checklist

- [x] spec: popup wrapped with `addPlugins` runs actions through its own plugins, timelines isolated in-memory during the test _(`spec/popup.spec.ts` — passed before the fix too; no code change needed for this half)_
- [x] spec: after the test, each `videoMode` instance still owns its artifacts _(`spec/popup.spec.ts` — was red on the collision, green after namespacing)_
- [x] decide artifact namespacing for multiple `videoMode` instances per test _(auto-index by registration order per `testInfo.outputDir` — no explicit name required; first instance keeps legacy unsuffixed names)_
- [x] implement the namespacing _(`suffixArtifactFileName` + `videoModeRegistrationCounts` in `src/plugins/video-mode.ts`, threaded through `state.artifactSuffix`)_
- [x] guard against registering an already-active `videoMode` instance on a second page _(throws from `pageExtension` before any state is touched; spec in `spec/popup.spec.ts`)_
- [x] ffmpeg-level spec with `video: "on"`: popup gets its own raw/rendered webm alongside the main page's _(`spec/popup-video.spec.ts`)_
- [x] README section on popups _(after Kitchen sink)_

## Implementation log

- 2026-08-13: investigated plugin-system + video-mode internals. Wrote `spec/popup.spec.ts` with an auth-popup demo app (`app.middlewright.test` opens `auth.middlewright.test`, Approve posts a message back to the opener; shared in `spec/auth-demo-app.ts`). Assumption: intended behavior is *separate* artifacts per instance, not a composited single video. Confirmed the collision (both report attachments shared one content hash), then implemented auto-index namespacing per user direction ("shouldn't require an explicit name"). Note: slugified `testInfo.name` wouldn't have helped — `outputDir` is already per-test; the collision was between two instances *within* one test, hence registration-order indexing. Full suite green (134 passed).
