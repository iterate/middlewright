---
status: in-progress
size: medium
---

# Use readable page fixtures in Playwright examples

## Status

Implementation is complete. Specs and snippets now use `basePage`/`page`, and UI checks use actions or waits instead of locator matchers. Type/build checks and focused specs pass; the full baseline run and PR video remain.

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
- [x] Rename wrapped Playwright page variables and fixture aliases consistently. *Updated plugin-using specs to reserve `page` for the enhanced page and `basePage` for Playwright's fixture.*
- [x] Replace redundant expect-based UI assertions with locator-driven behavior. *Removed action-repeating assertions and used observation waits for meaningful UI outcomes; metadata/value assertions remain.*
- [x] Update user-facing snippets that teach the old `plugged` naming. *Updated the README, demo-video fixture snippet, and the test-writing anti-example.*
- [ ] Run formatting, type checks, and relevant specs.
- [ ] Render `spec/todo-app.spec.ts` and attach its video to the pull request.
- [ ] Move this task to `tasks/complete/` and update the pull request when done.

## Implementation log

- 2026-08-04: Created from the user's edited `spec/video-mode-ffmpeg.spec.ts`; the root-worktree edit is reference only and will not be copied wholesale.
- 2026-08-04: Typecheck and build pass. Changed non-ffmpeg specs pass after moving observation-only video checks to page-level waits so they do not become recorded middleware actions.
- 2026-08-04: The full run passed 101 tests with four expected skips. One text-cursor pixel test failed under eight-way concurrency, passed immediately in isolation, and reproduced unchanged on `main` with its original `toHaveValue` assertion.
