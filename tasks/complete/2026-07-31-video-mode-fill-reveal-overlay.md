---
status: complete
size: medium
---

# Reveal filled text in post-production

## Status

Complete. Pointer-mode reveals pause after arrival, selector-trimmed videos calibrate against live page pixels, final holds use a clean screenshot, and six review-length videos are inline on PR #10. Full local validation passes.

## Goal

Offer an independent alternative to PR #8: make a completed `locator.fill()` draw the eye like typing without replacing the runtime action with `locator.type()`.

## Assumptions

- Base the comparison directly on `main`, including the video timeline calibration from #9.
- Keep the public call as `videoMode()`; do not add a configuration option solely for this comparison.
- Apply the effect to highlighted, non-empty `fill()` actions on visible editable elements.
- Capture the field geometry and visual context around the normal action.
- Render the stable pre-action screenshot outside the field.
- Place final content pixels over that screenshot at measured grapheme boundaries during the existing highlight hold.
- If a field is not safe to animate, hold its final post-fill screenshot rather than changing runtime behavior or failing the test.

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
- [x] Reveal only complete glyphs; never expose a thin slice of the next character. *The renderer advances through measured grapheme stops; the frame-level `@` regression rejects partial glyph pixels.*
- [x] Move the pointer to the field and switch to the text cursor before revealing text. *Pointer-mode reveals begin 100ms after cursor arrival; a frame-level regression checks that the text cursor precedes the first glyph.*
- [x] Cover gradient-backed fields without a mismatched solid-colour wipe. *Each completed content crop comes from post-fill pixels, preserving gradients and image-backed backgrounds.*
- [x] Support ordinary textareas and test scrolling and expanding textarea fallbacks. *Stable single-line textareas animate; scrolling and geometry-changing textareas hold a captured final state.*
- [x] Refresh PR media and rerun stress, full validation, and CI. *Six captioned clips are inline in PR #10; 60/60 initial stress runs, 40/40 post-CI-fix runs, the full local suite, and CI pass.*
- [x] Budget a stationary text-cursor pause before the first glyph, after pointer movement. *The remaining text-cursor budget is split evenly between a stationary pause and the glyph reveal, so mouse travel naturally consumes the configured hold.*
- [x] Make the focused media fixtures start on meaningful content and end on the filled state. *All six use selector-based starts; endpoint calibration matches the final live screenshot instead of Playwright's black close frame.*
- [x] Add a reviewable final-state hold without extending teardown black. *Final holds append the captured live-page frame for one second in the focused clips; the pointer regression checks the first and last ten frames.*
- [x] Replace PR media and rerun focused stress, full validation, and CI. *PR #10 has six new inline players; local validation and CI pass on `22d92ec`.*

## Implementation log

- 2026-07-31: Chose a side-by-side branch from `origin/main` so this post-production approach can be reviewed independently of PR #8's runtime typing approach.
- 2026-07-31: Completed two RED→GREEN slices. All 38 video-mode and FFmpeg specs pass.
- 2026-07-31: Inspected early, middle, and late native frames. They show `ada`, `ada@example`, then `ada@example.com` over the unchanged blue pre-action page.
- 2026-07-31: Full suite: 76 passed, 3 provider-gated tests skipped. Typecheck, build, and `publint` pass. The reveal regression passed 10 repeated runs with 2 workers.
- 2026-07-31: Uploaded the 6.8-second account-flow render to `github.com/user-attachments/assets/211cc473-5a55-44a2-987d-23ffcd6f3404`.
- 2026-07-31: Reopened from review feedback. The current continuous cover clips through glyphs, pointer motion overlaps the reveal, and textarea/gradient behavior needs explicit decisions and regression coverage.
- 2026-07-31: Replaced the moving solid cover with grapheme-width content crops, sequenced pointer arrival before reveal, and added gradient plus three textarea scenarios.
- 2026-07-31: Visual review exposed blank fallback holds. Scrolling and expanding textareas now replace the pre-action hold with a captured post-fill frame and updated geometry.
- 2026-07-31: Full suite: 82 passed, 3 provider-gated tests skipped. Six focused scenarios passed 60/60 with two workers; typecheck, build, and `publint` pass.
- 2026-07-31: Linux CI exposed a font-dependent two-pixel leak before `@`. Reveal stops now use each prefix's actual ink boundary instead of its advance width plus a gutter; the four animated scenarios passed another 40/40 stress run.
- 2026-07-31: Replaced the four affected media assets after the ink-boundary fix. PR #10 now contains six current captioned clips, and CI passed on `a622095`.
- 2026-07-31: Reopened after review found the captioned clips too short, with real black startup/teardown frames. The current reveal uses a fixed 100ms settle after arrival; the media specs disable start trimming and mostly disable final holds.
- 2026-07-31: Replaced the fixed settle with a budgeted pause, calibrated static recordings against the last live screenshot, and made `finalHold` append that clean frame. The full suite passes: 82 tests with 3 provider-gated skips.
- 2026-07-31: Six fresh 2.1–2.5s clips start on page content and hold the final state for one second. A 60-run stress pass exposed one inaccurate keyframe sample in the glyph test; its final-hold assertion then passed 10/10 after correction.
- 2026-07-31: Uploaded all six replacement clips and verified six rendered `<video>` players in the PR body. GitHub CI passes on `22d92ec`.
- 2026-07-31: A later Linux CI run exposed a recorder-dependent test fixture: its raw video contained final content from frame zero, so there was no encoded blank lead-in to trim. A two-pixel near-white animation now keeps visually blank fixture frames flowing until content paints; the focused suite passes 40/40 locally.
- 2026-07-31: Review follow-up removed all 13 fixed sleeps introduced by the reveal specs. Initial readiness uses locator waits; value, scrolling, expansion, and event assertions provide the post-action synchronization.
