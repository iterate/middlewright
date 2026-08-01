status: complete
size: small

# Start video mode at the first locator action by default

## Status

Complete. Default video trimming now starts at the first eligible locator invocation while explicit modes retain precedence. Focused and full verification pass.

## Goal

Make `videoMode()` start its rendered clip at the first locator method call (`waitFor`, `click`, `fill`, and the other intercepted locator actions) instead of inspecting recorded pixels for the end of a blank startup.

## Assumptions

- `trimStart: "auto"` uses the invocation timestamp of the first locator call that reaches `videoMode` middleware.
- Starting at invocation keeps the locator's Playwright auto-wait and the interaction itself in the clip; starting after it resolves could cut off the first click or fill.
- Calls excluded by `skipStackFrames` do not establish the start because they are intentionally treated as internal helpers.
- A failed first locator call still establishes the start; it is still the first attempted test interaction and can be useful failure context.
- An explicit `setStartTime()` set before the first locator call wins.
- Explicit `trimStart: ["selector", css]`, `"detect-blank"`, and `"never"` keep their existing behavior.
- If no locator action occurs, `"auto"` leaves the clip at its natural recorder start instead of running pixel detection.
- The first-locator fact stays inside `videoMode`; the plugin consumes neutral `ActionContext.timing` and does not couple to another plugin.

## Checklist

- [x] Add a public-behavior regression proving the default start is the first locator invocation. *The auto-start spec bounds the start around a delayed `waitFor()` invocation and proves a later click does not move it.*
- [x] Make default `trimStart: "auto"` record the first eligible locator action timestamp once. *`videoMode` consumes neutral `ActionTiming.actionStartedAt` before dispatching the first non-skipped action.*
- [x] Keep explicit start modes and manual `setStartTime()` authoritative. *Selector, blank detection, and never specs pass; the manual source-range spec now performs a locator action after setting its start.*
- [x] Remove default reliance on blank-frame detection while preserving explicit `"detect-blank"` support. *Resolved auto mode selects first-locator timing, while the pixel detector remains available only for explicit blank detection and selector fallback.*
- [x] Update the public `trimStart` docs and examples. *README and API docs show the first-action default and its retained auto-wait.*
- [x] Run focused video-mode specs, typecheck, build, and the full suite. *All 27 focused specs pass; the full suite has 88 passes and 3 provider-gated skips; typecheck, build, and publint pass.*
- [x] Move this task to `tasks/complete/` when the branch is done. *Moved with the 2026-08-01 completion date.*

## Implementation log

- 2026-08-01: Fleshed out from the default-start-time idea. Chose locator invocation rather than completion so the first interaction and its auto-wait remain visible.
- 2026-08-01: Added the failing first-locator spec, implemented the timing-based default, and retained explicit selector, blank-detection, never, and manual starts.
- 2026-08-01: Focused tests, full tests, typecheck, build, and package lint all pass.
- 2026-08-01: Made the checked-in first-locator fixture visually reviewable: its raw clip includes a clear setup screen, while the rendered clip retains only the locator's final 600 ms auto-wait before the ready state.
