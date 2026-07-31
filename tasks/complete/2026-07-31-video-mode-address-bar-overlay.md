status: in-progress
size: medium

# Video mode address bar overlay

## Status

Reopened after review. The option and visual design exist, but the live-page injection must be replaced with a post-render ffmpeg overlay. The replacement demo must come from the checked-in multi-navigation integration test.

## Goal

Make rendered `videoMode` recordings show where `page.goto()` navigates. Record the resolved destination and burn a compact Chrome-style address bar into the final video without changing the live page or delaying navigation.

## Assumptions

- The overlay belongs to `videoMode`, because it exists to make recorded videos easier to follow.
- It is enabled by default when `videoMode()` is active.
- `addressBar: false` opts out.
- `addressBar: { holdMs: number }` controls how long the post-rendered bar remains after `page.goto()` completes.
- `page.goto()` must return as soon as Playwright completes; video presentation must not slow the test.
- The displayed destination is the resolved URL known to Playwright, with long URLs visually truncated by CSS rather than changing their text.
- Navigation spans and URLs are public video metadata and stay aligned through trimming, dead-air compression, and synthetic action holds.
- The overlay is synthetic recording UI only: it must never enter the page DOM or raw video.
- PR demo media comes from a checked-in regression test, not an ignored one-off spec.

## Checklist

- [ ] Replace the live-page spec with public behavior proving `goto()` records navigation metadata without changing the DOM or delaying the call.
- [x] Add a `videoMode` option for the default overlay, opt-out, and hold duration. *`addressBar` defaults to a 1000ms hold, accepts an explicit `holdMs`, and supports `false`.*
- [ ] Burn timed Chrome-style address bars into `video-rendered.webm` with ffmpeg while leaving `video-raw.webm` untouched.
- [ ] Keep navigation overlays aligned through existing timeline transforms.
- [ ] Replace the ignored demo with a checked-in multi-navigation integration test containing visible interactions between navigations.
- [ ] Document the post-render behavior, metadata, and option.
- [ ] Run focused and full verification.
- [ ] Upload the checked-in integration test's rendered artifact as the PR demo.

## Implementation log

- 2026-07-31: Created the worktree task from the user request and reference screenshot. Chose a `videoMode`-owned overlay to preserve plugin boundaries.
- 2026-07-31: Added the failing public-behavior spec, then implemented and documented the default overlay.
- 2026-07-31: Generated a 960×540 demo recording and inspected frames with the overlay visible and removed.
- 2026-07-31: Uploaded the demo as an inline GitHub video for PR review.
- 2026-07-31: Replaced the single-navigation demo with a 10-second multi-page flow and inspected the settled state after every interaction.
- 2026-07-31: Reopened after review rejected live DOM injection. The implementation and demo source must both be replaced: rendering belongs in ffmpeg, and reviewer media belongs to a real checked-in test.
