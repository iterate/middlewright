---
status: in-progress
size: medium
---

# Reveal synthetic video text progressively

## Status

The prompt and navigation reveal slices are implemented through existing video-mode rendering paths. Next: add the public rendered-video regression for long-address containment, then regenerate review media and validate the full branch.

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

- [x] Add a failing rendered-video spec proving accepted prompt text advances through intermediate glyph states rather than appearing all at once. *The prompt input stayed effectively blank for the whole synthetic fill hold before the implementation; the frame-level spec now sees increasing dark-text pixels across early, middle, and late frames.*
- [x] Implement prompt text reveal within video mode while preserving fake-dialog pointer and text-cursor behavior. *The accepted prompt state feeds the same screenshot-backed grapheme reveal as ordinary `fill()`, retaining the existing fill highlight and text cursor before the OK click.*
- [x] Add a failing rendered-video spec proving a `page.goto()` destination advances through intermediate URL states. *Before implementation, early, middle, and late address-bar frames all contained the same 685 light text pixels; they now increase as the URL appears.*
- [x] Implement the address-bar reveal with shared synthetic-text timing where that simplifies the renderer. *ASS events expose successive Unicode grapheme prefixes during the synthetic hold, with a short blank lead-in and settled full URL at the end.*
- [ ] Add a failing rendered-video regression proving a long URL stays inside the address field and visible video bounds.
- [ ] Reduce address-bar URL type size and enforce rendering containment without changing recorded URL metadata.
- [ ] Document the default synthetic-text behavior.
- [ ] Run focused stress, the relevant/full suite, typecheck, build, and publint.
- [ ] Generate and inspect the todo raw/rendered pair and a focused long-address render.
- [ ] Upload native inline video players to the stacked draft PR and complete this task file.

## Implementation log

- 2026-08-03: Created `feature/video-mode-synthetic-text-reveal` from `origin/feature/video-mode-waitfor-highlight` in a sibling worktree. Chose a stacked draft PR so PR #15 remains independently reviewable.
- 2026-08-03: The prompt tracer bullet failed against the old all-at-once handoff, then passed after recording the accepted input as the post-fill frame for the existing grapheme-aware reveal renderer. The native prompt and live runtime remain untouched.
- 2026-08-03: The address tracer bullet proved the old ASS annotation painted all 685 light URL pixels in every sampled hold frame. Successive grapheme-prefix annotations now produce a clear start, middle, and complete destination without extending navigation runtime.
