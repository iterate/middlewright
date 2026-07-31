status: complete
size: medium

# Video mode address bar overlay

## Status

Complete. The overlay, option, cleanup, docs, and regression spec are ready for review. The PR demo now uses a three-navigation release flow with visible interactions between pages.

## Goal

Make `videoMode` recordings show where `page.goto()` navigates. During navigation, render a compact Chrome-style address bar at the top of the page with the destination URL, keep it visible briefly after navigation finishes, then remove it.

## Assumptions

- The overlay belongs to `videoMode`, because it exists to make recorded videos easier to follow.
- It is enabled by default when `videoMode()` is active.
- `addressBar: false` opts out.
- `addressBar: { holdMs: number }` controls how long the bar remains after `page.goto()` completes.
- The default hold is short enough to keep tests responsive while making the URL readable in a recording.
- The displayed destination is the resolved URL known to Playwright, with long URLs visually truncated by CSS rather than changing their text.
- The overlay is synthetic recording UI only: it must not change navigation results, page layout, or survive after its hold.

## Checklist

- [x] Add a public-behavior spec that navigates with a plugged page and observes the address bar during and after `goto()`. *`spec/video-mode.spec.ts` drives a routed navigation through the plugged page and observes the accessible status overlay.*
- [x] Add a `videoMode` option for the default overlay, opt-out, and hold duration. *`addressBar` defaults to a 1000ms hold, accepts an explicit `holdMs`, and supports `false`.*
- [x] Render a fixed, Chrome-style top overlay with the destination URL without shifting page content. *`video-mode.ts` mounts an isolated dark browser strip and rounded URL pill in a shadow root.*
- [x] Remove the overlay after navigation plus the configured hold, including when navigation throws. *The overlay is added only after successful navigation, removed in a `finally`, and waits through two paint frames so the recorder sees the clean state.*
- [x] Document the option and behavior. *The README configuration example and video-mode guide cover the default, custom hold, and opt-out.*
- [x] Run focused and full verification. *`pnpm typecheck`, `pnpm build`, and all 79 Playwright specs pass (76 passed, 3 skipped).*
- [x] Expand the PR demo after review feedback. *The replacement clip filters release runs, selects a browser, and reveals report details across three navigations.*

## Implementation log

- 2026-07-31: Created the worktree task from the user request and reference screenshot. Chose a `videoMode`-owned overlay to preserve plugin boundaries.
- 2026-07-31: Added the failing public-behavior spec, then implemented and documented the default overlay.
- 2026-07-31: Generated a 960×540 demo recording and inspected frames with the overlay visible and removed.
- 2026-07-31: Uploaded the demo as an inline GitHub video for PR review.
- 2026-07-31: Replaced the single-navigation demo with a 10-second multi-page flow and inspected the settled state after every interaction.
