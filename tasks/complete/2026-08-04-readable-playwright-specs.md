---
status: complete
size: medium
---

# Use readable page fixtures in Playwright examples

## Status

Complete. Specs and snippets use `basePage`/`page`, UI checks use actions or waits instead of locator matchers, CI is green, and the rendered todo-app baseline is attached to the draft pull request.

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
- [x] Run formatting, type checks, and relevant specs. *Typecheck, build, the full CI-shaped suite, focused start-behavior specs, and repeated FFmpeg boundary coverage pass.*
- [x] Render `spec/todo-app.spec.ts` and attach its video to the pull request. *The fresh WebM renders inline in draft PR #21.*
- [x] Move this task to `tasks/complete/` and update the pull request when done. *Completed on 2026-08-04; the PR body includes verification, visual baseline, and session ID.*

## Implementation log

- 2026-08-04: Created from the user's edited `spec/video-mode-ffmpeg.spec.ts`; the root-worktree edit is reference only and will not be copied wholesale.
- 2026-08-04: Typecheck and build pass. Changed non-ffmpeg specs pass after moving observation-only video checks to page-level waits so they do not become recorded middleware actions.
- 2026-08-04: The full run passed 101 tests with four expected skips. One text-cursor pixel test failed under eight-way concurrency, passed immediately in isolation, and reproduced unchanged on `main` with its original `toHaveValue` assertion.
- 2026-08-04: After removing that redundant matcher exposed a Linux encoder startup transient, the boundary regression samples the first stable decoded frame; it passed three concurrent repetitions and GitHub CI passed.
- 2026-08-04: Attached the fresh todo-app render to PR #21: https://github.com/user-attachments/assets/9b88f4ef-0281-4f87-a04c-e834f412e7ed
