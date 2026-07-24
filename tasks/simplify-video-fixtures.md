---
status: in-progress
size: medium
---

# Simplify video test fixtures

## Status

Specified and ready to implement. The cleanup will remove presentation-only test CSS across the video specs, preserve only styles that drive behavior or pixel assertions, and add representative rendered videos to the draft PR.

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

- [ ] Inventory every styled video fixture and classify each declaration as presentation-only or assertion-critical.
- [ ] Apply the already-reviewed account-flow cleanup from the root worktree.
- [ ] Remove presentation-only styling from the remaining video fixtures.
- [ ] Replace assertion-critical stylesheet rules with minimal one-line inline styles or direct state-transition updates.
- [ ] Confirm no `<style>` blocks or multiline style attributes remain in the affected specs.
- [ ] Run the focused video specs, typecheck, build, publint, and full suite.
- [ ] Visually inspect a representative set of rendered videos.
- [ ] Upload a handful of useful videos to the draft PR and explain what each demonstrates.

## Implementation log

- 2026-07-24: Created `test/simplify-video-fixtures` from `origin/main` so the PR excludes the root worktree's unrelated local `types: ["node"]` commit.
