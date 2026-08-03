---
status: in-progress
size: medium
---

# Reveal synthetic video text progressively

## Status

Implementation and media are complete on draft PR #17. Linux CI exposed a timestamp-sensitive prompt frame assertion; its full decoded hold now asserts blank, intermediate, and complete states. Final CI confirmation remains.

## Goal

Make text that exists only in video-mode's post-produced UI read like ordinary typing. Accepted prompt values and `page.goto()` destinations should appear progressively during their synthetic holds, while long URLs remain legible and inside the address field.

## Assumptions

- This work branches directly from `main` and preserves its first-locator automatic start and existing video rendering behavior.
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
- [x] Add a failing rendered-video regression proving a long URL stays inside the address field and visible video bounds. *A repeated path wrapped to 24 pixels across two lines before the fix; the final rendered pixels now form one compact line inside the calculated address-field clip.*
- [x] Reduce address-bar URL type size and enforce rendering containment without changing recorded URL metadata. *Address text scales from a 12px floor at 2.4% of video height, uses ASS no-wrap mode, and retains the existing right-edge clip.*
- [x] Document the default synthetic-text behavior. *The video-mode README now describes glyph reveals for goto and prompt text plus compact clipping for long destinations.*
- [x] Run focused stress, the relevant/full suite, typecheck, build, and publint. *The new specs passed 15/15 with three workers, all 30 FFmpeg specs pass, the full suite passes 96 tests with 3 provider-gated skips, and typecheck/build/publint are clean.*
- [x] Generate and inspect the todo raw/rendered pair and a focused long-address render. *Contact sheets confirm the todo prompt types into the fake dialog and the focused long URL reveals on one clipped line; the raw todo stays unchanged.*
- [x] Upload native inline video players to the draft PR and complete this task file. *PR #17 has GitHub user-attachment players for the rendered todo, raw todo, and focused address bar; rendered PR HTML contains three `<video>` elements.*

## Implementation log

- 2026-08-03: Created the replacement `feature/video-mode-synthetic-text-reveal-main` from latest `origin/main` in a fresh sibling worktree so this independent feature can target `main` directly.
- 2026-08-03: The prompt tracer bullet failed against the old all-at-once handoff, then passed after recording the accepted input as the post-fill frame for the existing grapheme-aware reveal renderer. The native prompt and live runtime remain untouched.
- 2026-08-03: The address tracer bullet proved the old ASS annotation painted all 685 light URL pixels in every sampled hold frame. Successive grapheme-prefix annotations now produce a clear start, middle, and complete destination without extending navigation runtime.
- 2026-08-03: The long-address regression exposed the reported overflow as ASS word wrapping: the clipped URL occupied two 12-pixel rows. `\\q2` keeps it on one line, and the smaller type remains within both horizontal clip edges in decoded output.
- 2026-08-03: Stress and full validation passed. Generated the todo journey from the current branch using PR #15's ignored fixture as a review-only input, then reran the checked-in long-address spec for focused media. Uploaded all three MP4s through GitHub's attachment editor and verified three native players in the rendered PR body.
- 2026-08-03: Linux CI rendered the expected prompt animation but two fixed sample timestamps occasionally landed on the same glyph state. Replaced timestamp sampling with an assertion over every decoded fill-hold frame, preserving the public blank → partial → complete requirement.
