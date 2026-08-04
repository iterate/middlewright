---
status: in-progress
size: medium
---

# Use readable page fixtures in Playwright examples

## Status

Just started. Scope and conventions are captured; implementation and verification remain.

## Goal

Make the repository's tests and demo snippets follow the Playwright guidance already documented in `writing-middlewright-tests.md`:

- alias Playwright's fixture to `basePage` when wrapping it with plugins
- name the wrapped page `page`, not `plugged`
- use locator actions and `waitFor()` for UI state instead of redundant expect-based assertions
- keep expect-based assertions for non-UI values such as metadata, paths, timings, and computed results

## Assumptions

- “Across the rest of the repo” covers checked-in specs and user-facing demo snippets that show `addPlugins` usage.
- Assertions that only repeat an immediately preceding action are removed.
- Meaningful UI outcomes are expressed through locators and `waitFor()`, not silently dropped.
- Product code and the public `addPlugins` API are unchanged.

## Checklist

- [x] Capture the intended naming and assertion conventions. *Documented above before implementation.*
- [ ] Rename wrapped Playwright page variables and fixture aliases consistently.
- [ ] Replace redundant expect-based UI assertions with locator-driven behavior.
- [ ] Update user-facing snippets that teach the old `plugged` naming.
- [ ] Run formatting, type checks, and relevant specs.
- [ ] Render `spec/todo-app.spec.ts` and attach its video to the pull request.
- [ ] Move this task to `tasks/complete/` and update the pull request when done.

## Implementation log

- 2026-08-04: Created from the user's edited `spec/video-mode-ffmpeg.spec.ts`; the root-worktree edit is reference only and will not be copied wholesale.
