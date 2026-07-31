---
status: in-progress
size: medium
---

# Reveal visible fills after scrolling or resizing

## Status

About 70% complete. The final-crop fallback, final geometry, horizontal scrolling, and placeholder cover are implemented and the full FFmpeg suite passes. Stress/full-suite validation and PR media remain.

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
- [ ] Stress the affected frame-level specs and run the full validation suite.
- [ ] Generate, inspect, and upload current videos for every focused scenario.
- [ ] Update the PR body, resolve review feedback, and move this task to `tasks/complete/`.

## Implementation log

- 2026-07-31: Follow-up requested after merging #10. Chose a best-effort final visible crop rather than recreating browser layout or synthetic typing in post-production.
- 2026-07-31: Completed the RED→GREEN scrolling tracer bullet, then covered expanded geometry and horizontal input scrolling through the same final-crop path.
- 2026-07-31: A combined run exposed inaccurate keyframe seeking in the new pixel assertions. They now sample the fully decoded 25fps stream; all 24 FFmpeg specs pass.
