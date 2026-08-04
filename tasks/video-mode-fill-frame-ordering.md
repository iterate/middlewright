---
status: in-progress
size: medium
---

# Keep synthetic fill frames in chronological order

## Status

Reopened and broadened. The original future-input time travel has a deterministic green regression, but removing broad `preAction` stabilization exposed one completed-value frame before the synthetic reveal. Missing: a failing regression for that second ordering bug, boundary-scoped stabilization, stress/full validation, and refreshed PR media.

## Goal

Rendered fills must remain chronological in both directions: never paste a future field over an earlier page, and never flash the completed value before its letter-by-letter reveal. Stabilization may cover only the recorder-late boundary frames it protects, never an unrelated raw-video gap.

## Ranked hypotheses

1. The raw recorder contains a completed fill frame immediately before the synthetic hold, and broad `preAction` used to mask it. Covering only the frame-aligned boundary should remove the flash without resurrecting earlier-page time travel.
2. Annotation-to-WebM calibration rounds the fill boundary one frame too late. Moving the cut to the preceding measured frame should remove the flash, but risks trimming legitimate live-action footage.
3. The fill cover begins at the synthetic reveal piece but must also cover a short recorder-late tail in the preceding piece. Extending only that cover across the measured overlap should make completed-text pixels monotonic.
4. The comparison composition introduced the flash. A fresh uncomposed render falsified this: its frame 89 is complete, frame 90 is empty/black, and progressive reveal starts at frame 118.

## Checklist

- [x] Commit this task specification before implementation. *Committed alone as `57007c2`, then opened draft PR #20.*
- [x] Unskip the merged frame-level repro and confirm it fails with the impossible welcome-page/input combination. *The unchanged test finds 15 consecutive hybrid frames (35–49) in 5.7 seconds.*
- [x] Test whether removing future `preAction` stabilization alone makes the repro green. *Deleting the broad overlay makes the repro pass and removes all `preAction` rendering state.*
- [x] Preserve scrolling, resizing, gradient, cursor, and text-reveal fill behavior. *Nine focused fill tests pass; the pre-existing text-cursor sampler flakes at the same 40% rate on untouched `main` and is unrelated.*
- [ ] Add a public-behavior frame regression rejecting any completed fill before the first partial reveal.
- [ ] Bind pre-action stabilization to measured boundary frames rather than an entire preceding gap.
- [ ] Keep the original earlier-page/future-input regression green under the boundary fix.
- [ ] Stress both ordering regressions and the scrolling, resizing, gradient, cursor, and text-reveal fill slice.
- [ ] Run the complete suite, typecheck, build, and publint; regenerate and inspect the focused before/after PR media.
- [x] Stress-run the regression and full fill-rendering slice, then run the complete suite, typecheck, build, and publint. *Regression passes 10/10; cursor assertion passes 30/30; full suite passes 103 with 3 provider skips, plus typecheck, build, and publint.*
- [x] Render and inspect the todo app; attach its current video to the PR body as the repository visual baseline requires. *Sampled the 21.96-second render every two seconds and attached it as a native player in PR #20.*
- [ ] Return this task to `tasks/complete/` when both ordering bugs and PR handoff are complete.

## Implementation log

- 2026-08-03: Created from merged `main` immediately after #15. The new branch deliberately keeps the repro separate from `waitFor()` highlighting.
- 2026-08-03: RED confirmed after unskipping: the renderer produces 15 frames containing both the Welcome marker and the future Title input crop.
- 2026-08-03: Hypothesis 1 was correct. `videoPieces()` labelled the whole gap before a fill with that future fill, and FFmpeg overlaid its screenshot crop for the full piece. Removing that label and overlay turns the repro green 10/10 under two workers without regressing the focused fill suite.
- 2026-08-03: Full validation exposed a pre-existing text-cursor sampler flake at the same rate on untouched `main`. The spec now searches the complete video for its cursor-then-reveal contract and checks background stability only during the final hold, avoiding assumptions about calculated slice and first-frame alignment.
- 2026-08-03: Final validation passes 103 tests with 3 provider-gated skips, typecheck, build, and publint. The todo contact sheet shows a monotonic login/create/review journey with no future-input overlay; its render is attached to PR #20.
- 2026-08-03: Removed the redundant `No todos yet` highlight from the demo journey and refreshed the todo baseline as a labelled raw-versus-rendered comparison.
- 2026-08-03: Added a side-by-side comparison of the exact frame-level repro at the pre-fix and post-fix commits; the buggy version visibly pastes the future blue input over the earlier red screen.
- 2026-08-04: Removed the todo raw/rendered player from the PR body so it does not distract from the targeted before/after repro.
- 2026-08-04: Reopened after native-rate inspection confirmed the post-fix video still flashes its completed fill for one frame before the synthetic reveal. The raw WebM contains the same recorder-late frame; PR #9 and #12 history confirms earlier calibration and `preAction` work targeted this exact bug class.
