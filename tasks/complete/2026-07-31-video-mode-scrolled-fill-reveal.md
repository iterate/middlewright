---
status: complete
size: medium
---

# Reveal visible fills after scrolling or resizing

## Status

Done. Every fill reveal pauses before text appears, expanding textareas stay at their initial size until that pause ends, and multiline fallbacks reveal one visible line at a time. Four slower inline PR videos show the final behavior; local validation and remote CI pass.

## Goal

Keep `locator.fill()` as one normal runtime action while making more completed fields look typed in the rendered video. When exact pre/post geometry cannot support #10's glyph-aware overlay, use the field's final visible pixels and final size for a best-effort reveal instead of falling back to a static hold.

## Assumptions

- Keep the public API unchanged; this is a deeper fallback inside the existing fill-reveal feature.
- Preserve #10's precise, complete-glyph reveal for stable non-scrolling fields.
- For scrolling and resizing fields, capture the final visible content box and composite it over an assumed field-background overlay at the final geometry.
- Reveal only what is visible in the final state. A scrolled field may therefore begin with text from the middle or end of the value.
- Prefer whole-glyph-looking reveal stops when they can be inferred cheaply; graceful pixel-crop progression is acceptable for this best-effort fallback.
- Never change the runtime event sequence: the page still receives one normal `fill()` update.
- Add placeholders to every focused reveal fixture so the videos show that placeholder pixels do not leak through the post-fill overlay.
- Base the PR directly on the #10 squash commit on `main`.

## Acceptance

- A vertically scrolling textarea reveals its final visible text progressively instead of holding a static final frame.
- An auto-expanding textarea reveals at its final geometry instead of holding a static final frame.
- A horizontally scrolling single-line input reveals its final visible text progressively.
- Stable input, gradient, and textarea behavior from #10 remains intact.
- Placeholder text is covered before the filled value reveal and is exercised in rendered-video assertions.
- Scrolling/resizing/placeholder scenarios have short inline videos in the PR body with meaningful starts and final-state holds.

## Checklist

- [x] Add one failing public-behavior FFmpeg spec for a vertically scrolling textarea reveal. *The tracer bullet failed because #10 emitted only a static `highlight.image`; it now asserts progressive final-visible pixels.*
- [x] Implement the minimal final-geometry/background-overlay fallback to make it pass. *`recordFillReveal()` records an opaque cover plus stepped final crop; the renderer draws the cover before compositing those steps.*
- [x] Add and pass an expanding-textarea reveal spec. *The highlight now adopts the post-fill rect and reveals at the expanded height.*
- [x] Add and pass a horizontally scrolling single-line input reveal spec. *The rendered hold exposes the final scrolled suffix progressively.*
- [x] Add placeholders and placeholder-pixel assertions across the focused reveal fixtures. *All four focused fixtures have placeholders; the stable textarea video holds a visible magenta placeholder before proving it is absent from the reveal.*
- [x] Stress the affected frame-level specs and run the full validation suite. *Focused scenarios pass 40/40; full suite passes 83 tests with 3 provider-gated skips; typecheck, build, and `publint` pass.*
- [x] Generate, inspect, and upload current videos for every focused scenario. *The PR body has four inline GitHub players covering a placeholder, vertical scrolling, horizontal scrolling, and textarea expansion.*
- [x] Update the PR body, resolve review feedback, and move this task to `tasks/complete/`. *PR #12 documents the fallback, limits, videos, and green validation; no review feedback is outstanding.*
- [x] Add a rendered-video regression proving a later textarea line stays covered while the first visible line reveals. *The old column wipe exposed 1,005 dark pixels in later rows at the early sample; the regression now requires fewer than 10.*
- [x] Reveal multiline final pixels one line-height band at a time while retaining the single-band input behavior. *Reveal metadata records visible bands aligned to the field's used line height and scroll offset; the renderer completes each band before advancing.*
- [x] Regenerate and inspect the affected videos, update PR #12, and return this task to `tasks/complete/` after green CI. *The scrolling and expanding clips were replaced with line-by-line videos; 20/20 stress iterations, 83-test suite, build, typecheck, `publint`, and current PR checks pass.*
- [x] Add rendered-frame regressions for a text-free pre-reveal pause in outline mode and initial textarea geometry during that pause. *The FFmpeg specs find a placeholder-free, text-free outlined frame and prove an expanding field's early outline is less than 75% of its final height.*
- [x] Share the reveal pause budget across pointer and outline modes, and switch resized fields to final geometry only when reveal starts. *Both modes now spend up to the 800ms text-cursor pause budget before reveal; changed fields keep their pre-fill cover and outline until that boundary.*
- [x] Replace affected PR videos again, validate, and complete the task after CI. *All four clips now show the full 800ms pause, a slower 800ms reveal, and a final hold; PR #12 has four inline players and both checks pass.*

## Implementation log

- 2026-07-31: Follow-up requested after merging #10. Chose a best-effort final visible crop rather than recreating browser layout or synthetic typing in post-production.
- 2026-07-31: Completed the RED→GREEN scrolling tracer bullet, then covered expanded geometry and horizontal input scrolling through the same final-crop path.
- 2026-07-31: A combined run exposed inaccurate keyframe seeking in the new pixel assertions. They now sample the fully decoded 25fps stream; all 24 FFmpeg specs pass.
- 2026-07-31: Inspected contact sheets for placeholder, scrolling textarea, horizontal input, and expanding textarea clips. The placeholder caption now spans both the click hold and reveal so it stays accurate under concurrent timing.
- 2026-07-31: Uploaded all four clips as inline GitHub video players, updated PR #12, and confirmed its test and release checks are green before completing the task.
- 2026-07-31: Review found the best-effort fallback visually read as a paragraph-wide column wipe. Reopened the task to use line-aligned raster bands without per-letter DOM measurement.
- 2026-07-31: Completed the line-band RED→GREEN slice. Explicit and browser-default line heights work, all 24 FFmpeg specs pass, and contact sheets show ordered lines for scrolling and expanding textareas.
- 2026-07-31: Replaced the two affected inline PR videos, confirmed all four players render, and completed the review follow-up after green local and remote checks.
- 2026-07-31: Review caught two related timeline gaps: outline mode bypassed the pre-reveal pause, and resized fields drew their final cover/outline from the first hold frame. Reopened for a timing/geometry regression slice.
- 2026-07-31: Added rendered RED regressions, shared the pause calculation across highlight modes, and retained initial fill geometry until reveal. All 24 FFmpeg specs and 50/50 focused stress runs pass.
- 2026-07-31: Lengthened the four PR media fixtures to a 1.6s highlight so reviewers see the full 800ms pause and a slower 800ms reveal; the adjusted cases pass 20/20 repeated runs.
- 2026-07-31: Inspected all four replacement contact sheets, uploaded fresh inline clips, verified GitHub rendered four video players, and completed the task with PR #12 clean and green.
