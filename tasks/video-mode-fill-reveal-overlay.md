---
status: ready
size: medium
---

# Reveal filled text in post-production

## Status

Specified; implementation has not started. The comparison should keep Playwright's normal runtime behavior and add only a rendered-video effect. Missing: failing spec, metadata capture, FFmpeg composition, docs, demo media, and validation.

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

- [ ] Add a failing public-behavior FFmpeg spec for runtime event fidelity and progressive rendered reveal.
- [ ] Capture the post-action field pixels and the cover geometry/colour without altering the action.
- [ ] Compose the field crop and shrinking cover into the stable pre-action highlight frame.
- [ ] Add a fallback spec for a fill target that cannot produce reveal metadata.
- [ ] Document the post-production fill effect and its runtime semantics.
- [ ] Generate and inspect comparison media for the PR.
- [ ] Run focused stress coverage, the full suite, typecheck, build, and `publint`.
- [ ] Move this task to `tasks/complete/` and update the draft PR body.

## Implementation log

- 2026-07-31: Chose a side-by-side branch from `origin/main` so this post-production approach can be reviewed independently of PR #8's runtime typing approach.
