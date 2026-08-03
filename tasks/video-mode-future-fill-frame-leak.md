---
status: ready
size: medium
---

# Stop future fill frames leaking into earlier video

## Status

The deterministic public-behavior repro is now green. Removing the future `preAction` crop fixes all 15 hybrid frames, while the scrolling, resizing, gradient, cursor, and text-reveal fill behaviors remain intact. Full validation and the todo visual baseline remain.

## Goal

Rendered video must never show a future input over an earlier page. Fill stabilization may cover only the frame boundary it was captured for, never the entire raw-video gap before the fill.

## Ranked hypotheses

1. `videoPieces()` assigns the next fill's `preAction` screenshot to the whole preceding gap. Removing that overlay should make the repro pass without affecting current fill regressions if later timeline fixes made it redundant.
2. The overlay is still needed at the immediate screenshot/action boundary. Removing it should fix the repro but break one or more scroll/resize/fill tests; bounding it to an explicitly recorded capture interval should satisfy both sets.
3. The source/action clock mapping is wrong independently of the overlay. Removing `preAction` stabilization would then leave the repro red, requiring instrumentation around raw timestamps and piece boundaries.
4. Crop geometry is the primary defect. This is least likely because the leaked control has correct future geometry but appears during the wrong page state.

## Checklist

- [x] Commit this task specification before implementation. *Committed alone as `57007c2`, then opened draft PR #20.*
- [x] Unskip the merged frame-level repro and confirm it fails with the impossible welcome-page/input combination. *The unchanged test finds 15 consecutive hybrid frames (35–49) in 5.7 seconds.*
- [x] Test whether removing future `preAction` stabilization alone makes the repro green. *Deleting the broad overlay makes the repro pass and removes all `preAction` rendering state.*
- [x] Preserve scrolling, resizing, gradient, cursor, and text-reveal fill behavior. *Nine focused fill tests pass; the pre-existing text-cursor sampler flakes at the same 40% rate on untouched `main` and is unrelated.*
- [x] ~~If stabilization remains necessary, bind it to recorded capture timing rather than a guessed duration or page-specific heuristic.~~ *Not needed: all stabilization-specific regressions pass without the future overlay.*
- [ ] Stress-run the regression and full fill-rendering slice, then run the complete suite, typecheck, build, and publint. *Pending.*
- [ ] Render and inspect the todo app; attach its current video to the PR body as the repository visual baseline requires. *Pending.*
- [ ] Move this task to `tasks/complete/` when the fix and PR handoff are complete. *Pending.*

## Implementation log

- 2026-08-03: Created from merged `main` immediately after #15. The new branch deliberately keeps the repro separate from `waitFor()` highlighting.
- 2026-08-03: RED confirmed after unskipping: the renderer produces 15 frames containing both the Welcome marker and the future Title input crop.
- 2026-08-03: Hypothesis 1 was correct. `videoPieces()` labelled the whole gap before a fill with that future fill, and FFmpeg overlaid its screenshot crop for the full piece. Removing that label and overlay turns the repro green 10/10 under two workers without regressing the focused fill suite.
