---
status: awaiting-video-review
size: medium
---

# Highlight successful locator waits in video mode

## Status

The `waitFor()` implementation and realistic todo-app example are complete. The app demonstrates spinner-backed slow list/detail loading, a card click, and a positive body `waitFor()` in a 3.64-second rendered flow. The local review page now has 28 videos. No pull request has been opened; only the user's pacing decision remains.

## Goal

Make a successful `locator.waitFor()` point out the resolved locator and hold it in the rendered video, just like other highlighted locator actions. This should make an awaited result visible to a human viewer without slowing the browser test.

## Assumptions

- A default or explicit `state: "visible"` wait is highlighted after it resolves, so the recorded rectangle and frame show the state the caller waited for.
- The existing `highlight` option owns both the visual mode and duration. Its default pointer mode and 1000 ms duration apply to `waitFor()` too; no second duration setting is added.
- `skipMethods: ["waitFor"]` remains the explicit opt-out, but `waitFor` is no longer skipped by default.
- Waiting time remains dead air. With `deadAirThreshold`, a long wait can still be compressed before the resolved-state hold.
- A successful hidden or detached wait has no visible rectangle and therefore cannot produce a target highlight.
- Pointer motion and the hold are post-rendered. They do not move the live browser mouse or add the configured duration to test runtime.
- All checked-in video-mode rendering specs will be run and their rendered videos collected into one local review folder before a PR is opened.

## Checklist

- [x] Add one failing public-behavior rendered-video spec for a delayed visible `waitFor()` that moves the pointer to the result and holds it without delaying the test. *The FFmpeg spec first failed with only the following click highlight, then passed with distinct wait-result and click holds while the live wait stayed below 600 ms.*
- [x] Record a post-resolution `waitFor()` highlight while preserving the preceding wait as dead air. *Middleware records elapsed wait timing first, then captures the visible resolved state for the ordinary synthetic highlight timeline.*
- [x] Keep `skipMethods: ["waitFor"]`, disabled highlighting, and non-visible terminal states well-defined. *Focused metadata specs cover the opt-out, the default 1000 ms duration, and an attached element that resolves hidden.*
- [x] Update public documentation for the new default and opt-out. *The video-mode README now describes the shared duration and `skipMethods` escape hatch.*
- [x] Run focused tests, typecheck, build, and the full relevant video-mode suite. *All 27 FFmpeg specs pass serially; the full suite passes 89 tests with 3 provider-gated skips, plus typecheck, build, and publint.*
- [x] Collect and inspect every rendered video-mode spec artifact for local review. *Twenty-five FFmpeg renders and two auto-start renders were sampled across five evenly-spaced frames and collected behind one local HTML player page.*
- [x] Stop before opening a pull request and hand the local videos back to the user. *The branch is pushed, but no PR exists.*

## Todo app review fixture

- [x] Add a readable `todo-app.spec.ts` whose test flow appears before all fixture/app code and uses locator actions instead of expect assertions or manual timeouts. *The test has two user-level actions at the top; types, `TodoDB`, timing, and `getAppHtml()` follow below.*
- [x] Back the client-only HTML app with a `TodoDB` whose list/detail delays and in-memory records are supplied by the test. *Two exposed functions connect the page-only app to configurable delayed list/detail reads without an HTTP server.*
- [x] Show meaningful loading UI while the initial list and selected todo body are delayed, allowing `spinnerWaiter` to extend the normal short action timeout. *Both 1.6s list loading and 1.4s detail loading show `data-spinner` progress UI and pass under the project's 1s action timeout.*
- [x] Open a todo card into a dialog and positively assert its body with `getByText(body).waitFor()`, producing a resolved-result video highlight. *The whole semantic card is clickable; the dialog body wait records the second full pointer hold.*
- [x] Render, inspect, and add the todo flow to the local review page without opening a PR. *The inspected render is 3.64s: both slow spans compress to 300ms while click/body highlights remain 1000ms. It is first on the 28-video local page.*

## Implementation log

- 2026-08-03: Created `feature/video-mode-waitfor-highlight` from `main` in a sibling worktree. Chose the existing global highlight duration as the configuration surface so action pacing stays consistent.
- 2026-08-03: The RED tracer bullet proved current `waitFor()` emitted dead air but no highlight. The GREEN path captures a visible post-resolution screenshot and starts its synthetic hold after capture, so selector-based start trimming retains it.
- 2026-08-03: The full renderer pass exposed video mode's own `trimStart: ["selector", css]` watcher as a second apparent `waitFor()`. It now calls the original Playwright method so internal bookkeeping cannot create user-facing highlights.
- 2026-08-03: Added the default-duration, explicit-skip, and hidden-result regressions. Updated frame-level fill tests to distinguish the new wait outline from later fill outlines and increased their decode buffer for longer review clips.
- 2026-08-03: Generated and sampled all 27 available rendered fixtures. Static review-page verification found 27 valid video streams and no missing sources. The local browser connector was unavailable, so the HTML handoff page was validated by its files and streams rather than automated playback controls.
- 2026-08-03: Read the root worktree's ignored draft middlewright guide and shaped the todo spec around it: no manual timeout, no expect visibility assertion, positive locator behavior, and real progress UI for every slow operation.
- 2026-08-03: The todo tracer bullet failed after the detail spinner disappeared without the requested body, producing spinner-waiter's targeted failure. Rendering the body made the same public test pass without changing its timeout or adding a sleep.
- 2026-08-03: The final todo video holds the loaded card click and dialog body while compressing 3s of fake database latency into 600ms. Full validation passes 90 tests with 3 provider-gated skips, plus typecheck, build, and publint.
