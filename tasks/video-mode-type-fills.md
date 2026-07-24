---
status: in-progress
size: small
---

# Type short fills in video mode

## Status

Specified; implementation has not started. The public option, 100-character boundary, semantic safeguards, one opt-out regression, docs, and PR video proof remain.

## Goal

Make text entry readable in rendered videos by having `videoMode` execute short `locator.fill()` calls as real sequential typing. Keep normal Playwright fill behavior available as an explicit opt-out.

## Public API

```ts
videoMode(); // short fills are typed by default
videoMode({ typeFills: false }); // preserve Playwright fill behavior
```

## Assumptions

- `typeFills` defaults to `true`; existing video-mode users get paced entry without changing config.
- Non-empty string values of at most 100 characters are typed. Empty or longer values keep Playwright's original `fill()` behavior.
- Rewritten fills clear any existing value before typing so callers keep `fill()` replacement semantics.
- The caller-facing action remains a `fill` in video metadata and highlights. Only the browser action changes.
- Fill options keep their applicable Playwright behavior when the action is cleared and typed.
- Rewriting belongs to `videoMode`; pages without the plugin and callers using `typeFills: false` are unchanged.
- The single new spec compares default sequential entry with the opt-out's original one-step fill behavior.
- Existing specs should pass without expectation changes. The rendered PR demo is the main proof for the default visual behavior.

## Checklist

- [ ] Add one failing public-behavior spec covering default sequential entry and `typeFills: false`.
- [ ] Let middleware replace the browser action without coupling the plugin system to video mode.
- [ ] Rewrite eligible fills to clear + type while preserving fill metadata and bypassing values over 100 characters.
- [ ] Document the default, opt-out, and character boundary.
- [ ] Run the focused spec, typecheck, build, publint, and full suite.
- [ ] Record, inspect, and attach a rendered before/after video to the draft pull request.
- [ ] Move this task to `tasks/complete/` and update the pull request body when validation is green.

## Implementation log

- 2026-07-24: Created `feature/video-mode-type-fills` from `origin/main`; the root worktree's unrelated `spec/video-mode-ffmpeg.spec.ts` edit and local-only `main` commits remain untouched.
