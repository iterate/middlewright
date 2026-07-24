---
status: in-progress
size: medium
---

# Simplify video test fixtures

## Status

Implementation and validation are complete. Presentation-only CSS is gone from all video specs; the remaining inline declarations drive visibility, geometry, blank-frame detection, or pixel assertions. Three inspected videos still need to be uploaded to the draft PR.

## Goal

Make video test fixtures read like tests rather than miniature styled applications. Delete styling that does not affect the behavior under test. Where geometry, color, visibility, or timing is part of an assertion, keep the minimum required declaration inline on one line.

## Assumptions

- The cleanup covers all video-related specs, not product rendering code.
- No `<style>` blocks should remain in the affected test fixtures.
- Inline `style="..."` attributes are acceptable only when a test depends on the declaration for visibility, actionability, blank-frame detection, or pixel analysis.
- Dynamic selector rules may become direct style updates in the fixture script when the visual state transition is what the test measures.
- Tests should keep their current public behavior, timing budgets, viewport sizes, and assertions.
- The PR should show a small representative set of videos, not every generated artifact.

## Checklist

- [x] Inventory every styled video fixture and classify each declaration as presentation-only or assertion-critical. *Reviewed all video fixture CSS in the three affected specs.*
- [x] Apply the already-reviewed account-flow cleanup from the root worktree. *The account flow now uses browser-default presentation while keeping its meaningful captions and behavior.*
- [x] Remove presentation-only styling from the remaining video fixtures. *Deleted 304 lines of fixture styling and markup.*
- [x] Replace assertion-critical stylesheet rules with minimal one-line inline styles or direct state-transition updates. *Kept only colors, geometry, visibility, and transitions consumed by video analysis.*
- [x] Confirm no `<style>` blocks or multiline style attributes remain in the affected specs. *Repository search and `git diff --check` are clean.*
- [x] Run the focused video specs, typecheck, build, publint, and full suite. *40 focused tests and the full 74-test suite pass; 3 optional LLM tests remain skipped.*
- [x] Visually inspect a representative set of rendered videos. *Checked contact sheets for captions, dead-air/highlights, dialog/cursor, and startup trimming.*
- [ ] Upload a handful of useful videos to the draft PR and explain what each demonstrates.

## Implementation log

- 2026-07-24: Created `test/simplify-video-fixtures` from `origin/main` so the PR excludes the root worktree's unrelated local `types: ["node"]` commit.
- 2026-07-24: Two focused failures identified functional cursor-detector inputs; restored only non-cursor target colors and target geometry.
- 2026-07-24: Selected the captions, dead-air/highlights, and synthetic dialog clips for PR review. The startup-trimming clip is correct but too slight to add review value.
