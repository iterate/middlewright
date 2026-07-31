status: in-progress
size: medium

# Video mode address bar overlay

## Status

About 10% complete. The intended behavior and API are specified; implementation and tests remain.

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

- [ ] Add a public-behavior spec that navigates with a plugged page and observes the address bar during and after `goto()`.
- [ ] Add a `videoMode` option for the default overlay, opt-out, and hold duration.
- [ ] Render a fixed, Chrome-style top overlay with the destination URL without shifting page content.
- [ ] Remove the overlay after navigation plus the configured hold, including when navigation throws.
- [ ] Document the option and behavior.
- [ ] Run focused and full verification.

## Implementation log

- 2026-07-31: Created the worktree task from the user request and reference screenshot. Chose a `videoMode`-owned overlay to preserve plugin boundaries.
