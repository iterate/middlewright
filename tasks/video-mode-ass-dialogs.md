---
status: in-progress
size: large
---

# Render video-mode dialogs with ASS

## Status

The tracer bullet is green: dialogs no longer touch page DOM, the renderer freezes the last clean raw frame and draws ASS phases before the pointer, and the 25 fps sequence now stays neutral through typing before selecting once. Edge coverage, full validation, docs, and review videos remain.

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

- [x] Add a failing public rendered-video regression for neutral white → progressive prompt text with white OK → blue OK, with no early selected frame. *The 25 fps decoded sequence fails because selected blue first appears at frame 24, before complete prompt text at frame 49.*
- [x] Replace in-page synthetic dialog capture with a clean-frame-plus-ASS dialog scene. *The Playwright observer records dialog facts and layout targets; FFmpeg clones the last frame before open and burns the ASS scene before cursor overlays.*
- [x] Add a public raw-video regression proving Middlewright dialog artwork never appears. *The prompt spec scans every raw frame over the panel area and rejects a white synthetic panel.*
- [x] Cover alert and confirm accept/dismiss behavior without changing Playwright listener or automatic-dismiss semantics. *Existing public metadata and rendered confirm regressions are green with the prepended observer and no-listener auto-dismiss intact.*
- [x] Cover prompt default, empty, Unicode, and long/wrapped message/value cases where practical. *Metadata distinguishes a Unicode default from an explicit empty acceptance; rendered coverage holds the default, clears it, keeps a long wrapped message readable, then selects OK.*
- [x] Preserve existing pointer motion, prompt/goto reveal behavior, dead-air timing, and clean post-dialog pacing. *All 30 pre-existing FFmpeg specs pass alongside the new dialog sequences.*
- [ ] Document the ASS approach and compare its code complexity, runtime overhead, layout limits, portability, and fidelity in the PR body. *README now documents the pure post-production path; reviewer comparison is pending final measurements.*
- [ ] Run focused stress tests, FFmpeg specs, full suite, typecheck, build, and publint.
- [ ] Generate and inspect focused rendered/raw prompt videos; add todo rendered/raw videos if the #15 fixture can be exercised without importing its code.
- [ ] Upload native GitHub video players and complete the task file.

## Implementation log

- 2026-08-03: Created `alternative/video-mode-ass-dialogs` from latest `origin/main` in a sibling worktree. Chose the rendered frame sequence as the first public-behavior feedback loop because it directly captures the reported one-frame state rewind at 25 fps.
- 2026-08-03: The prompt regression reproduces the time-travel ordering deterministically: the current screenshot-backed renderer leaks a selected OK frame before the neutral/typing phase finishes.
- 2026-08-03: Removed the page init-script and runtime DOM overlay. Dialog highlights now carry a clean-frame timestamp plus deterministic input/button geometry; a dedicated ASS pass draws the scene before pointer compositing.
- 2026-08-03: The first ASS pass exposed letterboxing: an 800×600 page was scaled into 600×450 content inside an 800×450 video. Dialog layout now uses the same scaled viewport as screenshots and pointer targets. The frame-order, raw-cleanliness, rendered confirm, post-roll, metadata, listener-order, auto-dismiss, and back-to-back checks pass.
- 2026-08-03: Added explicit-empty coverage with a Unicode default and long message. Empty acceptance now holds the default briefly, clears the input during the fill phase, and keeps it empty when OK becomes selected. The full 30-spec FFmpeg file passes.
