---
status: complete
size: small
source: https://github.com/iterate/iterate/pull/2080
---

# Backport the screenshot plugin

## Status

Complete. `screenshot()` is exported and documented with the Iterate command-line ergonomics, self-contained slugging, cross-page artifact numbering, failed-action safety, and debug-mode behavior. Focused specs, typecheck, and build pass; two unrelated video timing/pixel flakes seen under full-suite load each passed on focused rerun.

## Scope

Backport Iterate's opt-in screenshot helper as a first-class middlewright plugin. Keep the fixture-friendly `screenshot()` API and `PLAYWRIGHT_SCREENSHOT` command-line switch: semicolon-separated regular expressions match `locator.toString()`, and each successful match produces a full-page PNG in the Playwright test output and an attachment in its report.

Library-specific decisions:

- Keep environment parsing inside the plugin because temporary command-line opt-in without changing a fixture is the feature's main ergonomic benefit.
- Keep `PWDEBUG` as a hard no-op, matching the other bundled plugins.
- Implement readable locator slugs locally rather than depending on Iterate's private shared package.
- Share occurrence counts by `TestInfo`, so matching actions on multiple plugged pages cannot overwrite one another.
- Capture only after successful actions; a failed action must not leave a misleading artifact.

## Checklist

- [x] Add a public `screenshot()` plugin with environment-driven locator matching. _Implemented in `src/plugins/screenshot.ts`, including semicolon-separated regex parsing and `PWDEBUG` no-op behavior._
- [x] Save and attach readable, non-colliding full-page PNGs after successful matching actions. _Artifact names use self-contained locator slugging and per-`TestInfo` occurrence counts._
- [x] Cover the public behavior through Playwright integration specs, including multiple pages and failed actions. _`spec/screenshot.spec.ts` covers capture/attachment, repeats, two pages, failure, debug mode, and invalid patterns._
- [x] Export and document the plugin alongside the existing bundled plugins. _Added to the public plugin index, plugin table, dedicated README section, and kitchen-sink fixture._
- [x] Run focused tests, the full suite, typecheck, and build. _Screenshot specs, typecheck, and build pass. Two full-suite runs each exposed a different unrelated video-mode flake; both failing cases passed immediately on focused rerun._
- [x] Open and keep a draft pull request updated with reviewer-oriented usage and verification notes. _Draft PR #5 was opened from the isolated worktree after the spec-only commit._

## Implementation log

- 2026-07-23: Reviewed Iterate PR #2080 and middlewright's plugin/test conventions. Chose a direct ergonomic backport with no new dependency and one extra failure-path regression spec.
- 2026-07-23: Implemented the plugin test-first, then added cross-page, failure, debug, and malformed-pattern coverage.
- 2026-07-23: Verified focused behavior, typecheck, and build. Full-suite load exposed unrelated video-mode flakes at `spec/video-mode-ffmpeg.spec.ts:794` and `spec/video-mode.spec.ts:343`; each passed alone.
