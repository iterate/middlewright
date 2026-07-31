---
status: complete
size: medium
---

# Reveal filled text in post-production

## Status

Complete. Runtime-safe capture, progressive FFmpeg composition, fallback coverage, docs, direct comparison media, stress coverage, and the full local validation suite are green.

## Goal

Offer an independent alternative to PR #8: make a completed `locator.fill()` draw the eye like typing without replacing the runtime action with `locator.type()`.

## Assumptions

- Base the comparison directly on `main`, including the video timeline calibration from #9.
- Keep the public call as `videoMode()`; do not add a configuration option solely for this comparison.
- Apply the effect to highlighted, non-empty `fill()` actions on visible editable elements.
- Capture the field geometry and visual context around the normal action.
- Render the stable pre-action screenshot outside the field.
- Place the final field pixels over that screenshot, then shrink a computed-background-colour cover from left to right during the existing highlight hold.
- If the field cannot be captured safely, keep the ordinary stable highlight rather than changing runtime behavior or failing the test.

## Acceptance

- A page observing `input` events sees one normal `fill()` update, not synthetic per-character events.
- The rendered video progresses from a covered field to the final filled text during the highlight.
- Unrelated page changes caused by the fill do not leak into the held frame outside the field.
- Existing pointer/outline modes, captions, dead-air mapping, source trimming, and final holds keep working.

## Checklist

- [x] Add a failing public-behavior FFmpeg spec for runtime event fidelity and progressive rendered reveal. *The spec first failed with zero text pixels throughout the hold, while already confirming one normal `input` event.*
- [x] Capture the post-action field pixels and the cover geometry/colour without altering the action. *`recordFillReveal()` records the content box, composited background colour, and post-fill screenshot only after the original action succeeds.*
- [x] Compose the field crop and shrinking cover into the stable pre-action highlight frame. *The renderer crops final field pixels onto the pre-action screenshot and moves a clipped background-colour cover across them.*
- [x] Add a fallback spec for a fill target that cannot produce reveal metadata. *A fill whose input removes itself still succeeds and renders through the ordinary highlight path.*
- [x] Document the post-production fill effect and its runtime semantics. *The README states the one-fill runtime behavior, stable surrounding frame, and fallback.*
- [x] Generate and inspect comparison media for the PR. *The account-flow render was reviewed frame by frame and uploaded as a GitHub inline video asset.*
- [x] Run focused stress coverage, the full suite, typecheck, build, and `publint`. *The reveal spec passed 10/10 with two workers; the full suite passed 76 tests with 3 provider-gated skips.*
- [x] Move this task to `tasks/complete/` and update the draft PR body. *Completed on the feature branch; PR #10 describes the net effect, comparison, media, and validation.*

## Implementation log

- 2026-07-31: Chose a side-by-side branch from `origin/main` so this post-production approach can be reviewed independently of PR #8's runtime typing approach.
- 2026-07-31: Completed two RED→GREEN slices. All 38 video-mode and FFmpeg specs pass.
- 2026-07-31: Inspected early, middle, and late native frames. They show `ada`, `ada@example`, then `ada@example.com` over the unchanged blue pre-action page.
- 2026-07-31: Full suite: 76 passed, 3 provider-gated tests skipped. Typecheck, build, and `publint` pass. The reveal regression passed 10 repeated runs with 2 workers.
- 2026-07-31: Uploaded the 6.8-second account-flow render to `github.com/user-attachments/assets/211cc473-5a55-44a2-987d-23ffcd6f3404`.
