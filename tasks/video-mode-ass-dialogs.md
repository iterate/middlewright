---
status: in-progress
size: large
---

# Render video-mode dialogs with ASS

## Status

Started as an independent alternative on `main`. The first milestone is a frame-sequence regression for the blue → white prompt rewind; implementation and review videos are still missing.

## Goal

Render alert, confirm, and prompt interactions wholly in post-production with ASS primitives and text. Keep synthetic dialog artwork off the recorded application page so capture-only states cannot leak into raw or rendered video.

## Assumptions

- This approach is independent of the browser-rendered-layer experiment and targets `main` directly.
- Playwright's real `Dialog` remains authoritative for message, default value, accepted prompt text, accept/dismiss choice, listener order, and automatic dismissal.
- A clean application frame from dialog-open is frozen while the entire dialog scene is drawn with ASS; raw footage resumes only after resolution.
- The dialog uses a dim backdrop, centered panel, message, optional prompt input, and alert/confirm/prompt buttons.
- Prompt text reveals by Unicode grapheme. The selected action becomes blue only after typing finishes.
- Layout helpers and scene data keep ASS construction readable. No new public option is needed.
- Browser-native dialog UI remains absent from Playwright's raw page video; Middlewright must not add any dialog DOM to it.

## Checklist

- [ ] Add a failing public rendered-video regression for neutral white → progressive prompt text with white OK → blue OK, with no early selected frame.
- [ ] Replace in-page synthetic dialog capture with a clean-frame-plus-ASS dialog scene.
- [ ] Add a public raw-video regression proving Middlewright dialog artwork never appears.
- [ ] Cover alert and confirm accept/dismiss behavior without changing Playwright listener or automatic-dismiss semantics.
- [ ] Cover prompt default, empty, Unicode, and long/wrapped message/value cases where practical.
- [ ] Preserve existing pointer motion, prompt/goto reveal behavior, dead-air timing, and clean post-dialog pacing.
- [ ] Document the ASS approach and compare its code complexity, runtime overhead, layout limits, portability, and fidelity in the PR body.
- [ ] Run focused stress tests, FFmpeg specs, full suite, typecheck, build, and publint.
- [ ] Generate and inspect focused rendered/raw prompt videos; add todo rendered/raw videos if the #15 fixture can be exercised without importing its code.
- [ ] Upload native GitHub video players and complete the task file.

## Implementation log

- 2026-08-03: Created `alternative/video-mode-ass-dialogs` from latest `origin/main` in a sibling worktree. Chose the rendered frame sequence as the first public-behavior feedback loop because it directly captures the reported one-frame state rewind at 25 fps.
