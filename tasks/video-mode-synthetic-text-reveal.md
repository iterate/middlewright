---
status: in-progress
size: medium
---

# Reveal synthetic video text progressively

## Status

The stacked worktree and implementation brief are ready. No production code has changed yet. Next: add one public rendered-video regression at a time for prompts, navigation URLs, and long-address containment, then regenerate review media and validate the full branch.

## Goal

Make text that exists only in video-mode's post-produced UI read like ordinary typing. Accepted prompt values and `page.goto()` destinations should appear progressively during their synthetic holds, while long URLs remain legible and inside the address field.

## Assumptions

- This work stacks on PR #15 and preserves its wait highlights, first-locator automatic start, endpoint-only timeline calibration, and default pacing.
- Prompt and address-bar reveals are post-production effects. They must not dispatch browser input events or delay the live Playwright operation.
- Reveals advance by Unicode grapheme, not UTF-16 code unit, so a visible glyph is never split.
- Existing highlight/hold timing supplies the animation budget; no new public option is needed.
- A prompt's default value is the initial visible state. Accepted replacement text reveals toward the submitted value.
- Long URLs keep their full recorded metadata but render at a smaller size and remain clipped within the visible address pill.

## Checklist

- [ ] Add a failing rendered-video spec proving accepted prompt text advances through intermediate glyph states rather than appearing all at once.
- [ ] Implement prompt text reveal within video mode while preserving fake-dialog pointer and text-cursor behavior.
- [ ] Add a failing rendered-video spec proving a `page.goto()` destination advances through intermediate URL states.
- [ ] Implement the address-bar reveal with shared synthetic-text timing where that simplifies the renderer.
- [ ] Add a failing rendered-video regression proving a long URL stays inside the address field and visible video bounds.
- [ ] Reduce address-bar URL type size and enforce rendering containment without changing recorded URL metadata.
- [ ] Document the default synthetic-text behavior.
- [ ] Run focused stress, the relevant/full suite, typecheck, build, and publint.
- [ ] Generate and inspect the todo raw/rendered pair and a focused long-address render.
- [ ] Upload native inline video players to the stacked draft PR and complete this task file.

## Implementation log

- 2026-08-03: Created `feature/video-mode-synthetic-text-reveal` from `origin/feature/video-mode-waitfor-highlight` in a sibling worktree. Chose a stacked draft PR so PR #15 remains independently reviewable.
