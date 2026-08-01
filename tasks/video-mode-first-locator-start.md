status: ready
size: small

# Start video mode at the first locator action by default

## Status

Specified and ready to implement. The intended default is the first user locator call; tests, code, docs, and full verification remain.

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

- [ ] Add a public-behavior regression proving the default start is the first locator invocation.
- [ ] Make default `trimStart: "auto"` record the first eligible locator action timestamp once.
- [ ] Keep explicit start modes and manual `setStartTime()` authoritative.
- [ ] Remove default reliance on blank-frame detection while preserving explicit `"detect-blank"` support.
- [ ] Update the public `trimStart` docs and examples.
- [ ] Run focused video-mode specs, typecheck, build, and the full suite.
- [ ] Move this task to `tasks/complete/` when the branch is done.

## Implementation log

- 2026-08-01: Fleshed out from the default-start-time idea. Chose locator invocation rather than completion so the first interaction and its auto-wait remain visible.
