---
status: ready
size: medium
---

# Highlight successful locator waits in video mode

## Status

The `waitFor()` implementation and kitchen-sink todo-app example are complete and ready to merge. The latest raw/rendered comparison is attached to PR #15. A separate future-fill frame-compositing regression is checked in but skipped so it can be fixed independently after this feature lands.

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
- [x] Run focused tests, typecheck, build, and the full relevant video-mode suite. *All 28 FFmpeg specs pass serially; the full suite passes 91 tests with 3 provider-gated skips, plus typecheck, build, and publint.*
- [x] Collect and inspect every rendered video-mode spec artifact for local review. *Twenty-five FFmpeg renders and two auto-start renders were sampled across five evenly-spaced frames and collected behind one local HTML player page.*
- [x] Hand the local videos back to the user before asking for review. *The branch and local review page were prepared first; a separate agent subsequently opened draft PR #15.*

## Todo app review fixture

- [x] Add a readable `todo-app.spec.ts` whose test flow appears before all fixture/app code and uses locator actions instead of expect assertions or manual timeouts. *The top-level test reads as login, three creates, then three detail reviews; types, `TodoDB`, timing, and `getAppHtml()` follow below.*
- [x] Back the client-only HTML app with a `TodoDB` whose auth/create/list/detail delays and in-memory records are supplied by the test. *Four exposed functions connect the page-only app to the configurable fake database without an HTTP server.*
- [x] Show meaningful loading UI while authentication, list refreshes, creation, and selected todo bodies are delayed, allowing `spinnerWaiter` to extend the normal short action timeout. *Every fake database operation displays a labelled `data-spinner` state and passes under the project's 1s action timeout.*
- [x] Add todos one by one, then open each card and positively assert its body with `getByText(body).waitFor()`. *The test creates three records through the UI and reviews all three semantic cards and dialogs.*
- [x] Add a prompt-based login so the video includes native dialog handling. *The Sign in action asks “Enter the password”, accepts the configured test password, and shows a slow authentication state.*
- [x] Render, inspect, and add the kitchen-sink flow to the local review page. *The inspected render is 29.28s with 26 meaningful highlights, compressed slow spans, and no internal full-viewport wait highlight.*
- [x] Make the test read as one explicit user journey rather than data-driven loops. *All three creates and all three detail reviews are written out, with choice body substrings used for visible-result waits.*
- [x] Make fake database latency adjustable during the journey. *`TodoDB.setDelay(ms)` replaces the per-method constructor config, and the test selects seven different delays across login, creation, and detail loading.*
- [x] Make the demo's pacing the default `videoMode()` experience. *The default dead-air cap is now 300ms and the default final hold is 1000ms; the existing auto trim replaces the fixture's selector override.*
- [x] Preserve the todo demo as a pull-request visual baseline. *Repository agent guidance now requires the rendered todo video on every PR and the raw recording when recording/rendering changes.*
- [x] Make the raw creation wait visibly painful without hiding the submitted values in filled fields. *The form resets as soon as submission captures its values, and the second todo uses a 10-second fake database delay; this was intentionally not rerun at the user's request.*

## Stale-frame flicker regression

- [x] Prove whether the flashes are old source frames or an overlay/filter illusion. *Rendered frame 209 at 8.36s was pixel-equivalent to raw frame 11 at 0.44s, proving that old source footage was replayed.*
- [x] Find why the raw timeline was shifted backwards. *The final todo-list screenshot was absent from the screencast, so final-paint calibration matched an identical todo-list state roughly 2.4 seconds earlier.*
- [x] Add a rendered-video regression with a final state that repeats an earlier state. *The red-green frame sequence failed as green/red/green/red/green before the fix and now stays green/red/green.*
- [x] Replace ambiguous pixel calibration with the recorder-settle endpoint. *The existing unique settle phase and close timestamp now remain the sole source-to-action clock calibration.*
- [x] Keep a post-resolution `waitFor()` hold from resuming on the preceding encoded frame. *Screenshot-backed highlights advance the source cursor by one frame before live footage resumes.*
- [x] Audit the kitchen-sink render for old-state recurrence. *The detector found ten stale matches in the old render after Todo desk appeared and none in the fixed render.*

## Implementation log

- 2026-08-03: Created `feature/video-mode-waitfor-highlight` from `main` in a sibling worktree. Chose the existing global highlight duration as the configuration surface so action pacing stays consistent.
- 2026-08-03: The RED tracer bullet proved current `waitFor()` emitted dead air but no highlight. The GREEN path captures a visible post-resolution screenshot and starts its synthetic hold after capture, so selector-based start trimming retains it.
- 2026-08-03: The full renderer pass exposed video mode's own `trimStart: ["selector", css]` watcher as a second apparent `waitFor()`. It now calls the original Playwright method so internal bookkeeping cannot create user-facing highlights.
- 2026-08-03: Added the default-duration, explicit-skip, and hidden-result regressions. Updated frame-level fill tests to distinguish the new wait outline from later fill outlines and increased their decode buffer for longer review clips.
- 2026-08-03: Generated and sampled all 27 available rendered fixtures. Static review-page verification found 27 valid video streams and no missing sources. The local browser connector was unavailable, so the HTML handoff page was validated by its files and streams rather than automated playback controls.
- 2026-08-03: Read the root worktree's ignored draft middlewright guide and shaped the todo spec around it: no manual timeout, no expect visibility assertion, positive locator behavior, and real progress UI for every slow operation.
- 2026-08-03: The todo tracer bullet failed after the detail spinner disappeared without the requested body, producing spinner-waiter's targeted failure. Rendering the body made the same public test pass without changing its timeout or adding a sleep.
- 2026-08-03: The initial todo video held the loaded card click and dialog body while compressing 3s of fake database latency into 600ms. Full validation passed 90 tests with 3 provider-gated skips, plus typecheck, build, and publint.
- 2026-08-03: Expanded the todo fixture into a kitchen-sink journey: native prompt login, three UI-created todos, and three slow-loaded detail dialogs. A prompt render exposed video mode's own overlay isolation `waitFor()` as a full-screen user highlight; that internal call now uses the original Playwright method, with a focused regression covering the action timeline.
- 2026-08-03: Sampled the 29.28s kitchen-sink render across ten frames. Its 26 highlights cover only the user's click, fill, and visible-wait actions; the local review page keeps it first for pacing review.
- 2026-08-03: Final kitchen-sink validation passes the full suite (90 passed, 3 provider-gated skips), typecheck, build, and publint.
- 2026-08-03: Refactored `getAppHtml()` so its document structure stays readable at the top, with nested `run()` and `getStyle()` functions supplying the serialized client script and CSS. The unchanged browser flow passes and renders 26 highlights in 29.12s.
- 2026-08-03: Stacked the title and details fields, increased the textarea to a two-line height, and moved creation progress into the fixed-width submit button. The button carries `data-spinner` while disabled, preserving spinner-waiter behavior without adding a layout-shifting status row.
- 2026-08-03: Confirmed the stock Playwright HTML report displays inline `video-raw`, `video-rendered`, and native `video` players. The native and video-mode raw files are byte-identical, so the report is sufficient for side-by-side artifact review; the custom page remains useful only as an all-fixtures gallery.
- 2026-08-03: Diagnosed the reported flashes frame by frame. The rendered video replayed exact raw frames from the sign-in screen; the raw video itself remained monotonic. The final live todo-list paint was never encoded, causing final-screenshot pixel calibration to latch onto an earlier occurrence of the same state and shift every source cut backwards.
- 2026-08-03: Removed final-page pixel matching as a timing heuristic and retained the settled recorder endpoint as the single calibration marker. Advanced post-resolution wait highlights past the conservative frame-floor boundary. A repeated-final-state regression now detects both the multi-second shift and the one-frame replay.
- 2026-08-03: Clean validation passes 91 tests with 3 provider-gated skips, typecheck, build, and publint. Regenerated the todo demo last so the Playwright report contains its raw and rendered players, and preserved the old flickering render beside the fixed one for local comparison.
- 2026-08-03: Unrolled the todo fixture's create/review loops so the test itself shows the whole journey, shortened body assertions to readable identifying text, and replaced fixed per-operation delays with imperative `TodoDB.setDelay()` calls between interactions.
- 2026-08-03: Promoted the fixture's 300ms dead-air cap and 1000ms final hold to `videoMode()` defaults. Default-behavior renderer specs cover both values, while the fixture now uses `videoMode()` with no options and relies on the existing automatic startup trim.
- 2026-08-03: Added repository guidance requiring the todo render in every PR body, plus the raw recording for changes to the recording/rendering path.
- 2026-08-03: Post-default validation covers all 94 tests: the non-FFmpeg suite passed 63 with 3 provider-gated skips; one known first-frame sampling flake in the combined run passed 5/5 immediately afterward, then all 28 FFmpeg specs passed cleanly. Typecheck, build, and publint also pass. The regenerated default-options todo render is 25.32s with 26 highlights and no stale sign-in-frame matches.
- 2026-08-03: Moved `todoForm.reset()` to the start of submission so title/details clear throughout “Creating…”, and raised the second todo's fake delay to 10 seconds to sharpen the raw-versus-rendered contrast. Per the user's request, did not run the spec or regenerate media for this tweak.
- 2026-08-03: Merged latest `origin/main`, restoring PR #14's first-locator `trimStart: "auto"` behavior while retaining this branch's wait highlights, review-friendly defaults, and endpoint-only timeline calibration. Preserved the user's 5-second todo delay and helper cleanup; left the rerun to the user as requested.
- 2026-08-03: Kept the deterministic future-fill frame-compositing repro as a skipped spec so PR #15 can merge independently. Its follow-up will unskip the same public-behavior test before changing the renderer.
