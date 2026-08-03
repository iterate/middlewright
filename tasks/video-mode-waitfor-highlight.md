---
status: in-progress
size: medium
---

# Highlight successful locator waits in video mode

## Status

Specification ready; implementation and review videos have not started. The branch will stop before opening a pull request so the pacing can be reviewed locally first.

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

- [ ] Add one failing public-behavior rendered-video spec for a delayed visible `waitFor()` that moves the pointer to the result and holds it without delaying the test.
- [ ] Record a post-resolution `waitFor()` highlight while preserving the preceding wait as dead air.
- [ ] Keep `skipMethods: ["waitFor"]`, disabled highlighting, and non-visible terminal states well-defined.
- [ ] Update public documentation for the new default and opt-out.
- [ ] Run focused tests, typecheck, build, and the full relevant video-mode suite.
- [ ] Collect and inspect every rendered video-mode spec artifact for local review.
- [ ] Stop before opening a pull request and hand the local videos back to the user.

## Implementation log

- 2026-08-03: Created `feature/video-mode-waitfor-highlight` from `main` in a sibling worktree. Chose the existing global highlight duration as the configuration surface so action pacing stays consistent.
