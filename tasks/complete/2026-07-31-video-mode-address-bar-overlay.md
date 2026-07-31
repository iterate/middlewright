status: complete
size: medium

# Video mode address bar overlay

## Status

Complete. Navigation metadata drives synthetic ffmpeg holds without touching or slowing the live page. Checked-in regressions cover multi-navigation, top-edge clicks, and captions that span an address-bar hold. The branch includes current `main`.

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

- [x] Replace the live-page spec with public behavior proving `goto()` records navigation metadata without changing the DOM or delaying the call. *A 5000ms configured hold returns locally in about 80ms, leaves a mutation sentinel untouched, and records the resolved URL.*
- [x] Add a `videoMode` option for the default overlay, opt-out, and hold duration. *`addressBar` defaults to a 1000ms hold, accepts an explicit `holdMs`, and supports `false`.*
- [x] Burn timed Chrome-style address bars into `video-rendered.webm` with ffmpeg while leaving `video-raw.webm` untouched. *Synthetic destination-frame pieces and ASS annotations are composed only in the ffmpeg filter graph.*
- [x] Keep navigation overlays aligned through existing timeline transforms. *Address-bar pieces share the same rendered-piece projection as captions and highlights.*
- [x] Replace the ignored demo with a checked-in multi-navigation integration test containing visible interactions between navigations. *The release-flow test filters runs, selects Chromium, and reveals report details across three URLs.*
- [x] Show how a top-edge click behaves when the address bar covers its target. *The regression proves the bar hold and click highlight do not overlap, while its rendered artifact exposes the target being hidden before the click.*
- [x] Keep navigation captions visible throughout synthetic address-bar holds. *Caption projection includes exact hold-boundary matches and extends them through the rendered piece.*
- [x] Document the post-render behavior, metadata, and option. *README now distinguishes metadata, raw video, post-rendered holds, and live navigation behavior.*
- [x] Run focused and full verification. *All 48 focused video specs pass serially; the merged full suite passes 86 tests with 3 provider-gated skips; typecheck, build, and publint pass.*
- [x] Upload checked-in integration-test artifacts for PR review. *The 5.6-second release flow is the main demo; a 3.24-second top-edge clip exposes the overlay tradeoff.*

## Implementation log

- 2026-07-31: Created the worktree task from the user request and reference screenshot. Chose a `videoMode`-owned overlay to preserve plugin boundaries.
- 2026-07-31: Added the failing public-behavior spec, then implemented and documented the default overlay.
- 2026-07-31: Generated a 960×540 demo recording and inspected frames with the overlay visible and removed.
- 2026-07-31: Uploaded the demo as an inline GitHub video for PR review.
- 2026-07-31: Replaced the single-navigation demo with a 10-second multi-page flow and inspected the settled state after every interaction.
- 2026-07-31: Reopened after review rejected live DOM injection. The implementation and demo source must both be replaced: rendering belongs in ffmpeg, and reviewer media belongs to a real checked-in test.
- 2026-07-31: Replaced page injection with resolved-URL metadata and synthetic destination-frame pieces annotated by ffmpeg ASS rendering.
- 2026-07-31: The checked-in release-flow regression passed three consecutive renders; all 38 focused video specs then passed serially.
- 2026-07-31: Full validation passed with 76 tests and 3 provider-gated skips. Uploaded the checked-in test's rendered artifact and removed the ignored demo spec.
- 2026-07-31: Added a top-edge click regression. The bar and click highlight remain sequenced, but visual review confirms the transient bar hides useful page chrome before the target appears; reserving stable browser chrome outside the page viewport is the suggested follow-up.
- 2026-07-31: Merged `origin/main`, preserving its fill-reveal specs alongside the address-bar coverage. Fixed Bugbot's caption report with a default-caption regression that reproduced 11 address-bar frames and zero captioned frames before the fix.
