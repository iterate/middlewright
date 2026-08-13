---
status: in-progress
size: medium
branch: popup-plugins
---

# Popup support (auth popout windows)

**Status summary**: investigation done, spec written. Wrapping a popup with `addPlugins` already works for middleware plugins — no code change needed there, and a passing spec proves it. Video mode has a real gap: two `videoMode()` instances in one test clobber each other's artifacts; a failing intended-behavior spec captures it. The fix (artifact namespacing) is not implemented yet.

The pattern this should support:

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
- **videoMode: yes, sort of.** Two hazards, one per way you might wire it:
  1. **Reusing the same `videoMode()` instance** on page + popup is broken: the plugin holds one per-test `state` closure, and its `beforeTest` handler resets it — wrapping the popup mid-test wipes the main page's highlights/captions recorded so far.
  2. **A fresh `videoMode()` instance per popup** is the right model (Playwright screencasts each page separately; the instance's timebase is its creation time ≈ popup screencast start). But artifact filenames are fixed per `testInfo.outputDir` (`video-mode.json`, `video-raw.webm`, `video-mode-highlight-N.png`, …), so the two instances clobber each other: whichever page disposes last overwrites, and afterwards `metadata()`/`outputPaths()` on the popup instance read the *main page's* artifacts.
- A single combined video (main page + popup interleaved) would require compositing two screencasts and is out of scope. Separate videos per page is the natural model.

## Checklist

- [x] spec: popup wrapped with `addPlugins` runs actions through its own plugins, timelines isolated in-memory during the test _(`spec/popup.spec.ts`, passes — no code change needed for this half)_
- [x] spec: after the test, each `videoMode` instance still owns its artifacts _(`spec/popup.spec.ts`, intended-behavior spec — fails today: both instances resolve `video-mode.json` in the same outputDir, and the two report attachments even share one content hash)_
- [ ] decide artifact namespacing for multiple `videoMode` instances per test (auto-index like `video-mode-2.json`, vs explicit `videoMode({ name: "popup" })`)
- [ ] implement the namespacing (metadata, raw/rendered video, highlight/pan images, player HTML, attachment names)
- [ ] guard against registering an already-active `videoMode` instance on a second page (clear error pointing at fresh-instance-per-page)
- [ ] ffmpeg-level spec with `video: "on"`: popup gets its own raw/rendered webm alongside the main page's
- [ ] README section on popups (fresh plugin instances per popup, `await using` so the popup finalizes)

## Implementation log

- 2026-08-13: investigated plugin-system + video-mode internals. Wrote `spec/popup.spec.ts` with an auth-popup demo app (`app.middlewright.test` opens `auth.middlewright.test`, Approve posts a message back to the opener). Assumption: intended behavior is *separate* artifacts per instance, not a composited single video. Test run confirms: middleware test green, artifact test red at `outputPaths()` equality.
