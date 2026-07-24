---
status: in-progress
size: small
---

# Type short fills in video mode

## Status

Nearly complete. Default short-fill typing, opt-out, live rendered field footage, docs, and local validation are green; PR media and CI on the final commit remain.

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
- Timeout/no-wait fill options carry into typing. Forced fills keep the original action because Playwright typing has no equivalent force option.
- Rewriting belongs to `videoMode`; pages without the plugin and callers using `typeFills: false` are unchanged.
- The single new spec compares default sequential entry with the opt-out's original one-step fill behavior.
- Existing specs should pass without expectation changes. The rendered PR demo is the main proof for the default visual behavior.

## Checklist

- [x] Add one failing public-behavior spec covering default sequential entry and `typeFills: false`. *The spec observes real input-event values: clear plus `A`/`Ad`/`Ada` by default, versus one `Ada` event when opted out.*
- [x] Let middleware replace the browser action without coupling the plugin system to video mode. *`NextAction` lets any middleware replace the eventual original method and args while downstream middleware sees the replacement.*
- [x] Rewrite eligible fills to clear + type while preserving fill metadata and bypassing values over 100 characters. *Video mode records the incoming fill, clears through the original action, then dispatches a 50 ms sequential type; empty, long, and forced fills are untouched.*
- [x] Document the default, opt-out, and character boundary. *README covers pacing, metadata, exclusions, and `typeFills: false`.*
- [x] Run the focused spec, typecheck, build, publint, and full suite. *Focused behavior/render regressions passed; typecheck, build, and publint passed; the final full run passed 75 tests with 3 provider-gated skips.*
- [ ] Record, inspect, and attach a rendered before/after video to the draft pull request.
- [ ] Move this task to `tasks/complete/` and update the pull request body when validation is green.

## Implementation log

- 2026-07-24: Created `feature/video-mode-type-fills` from `origin/main`; the root worktree's unrelated `spec/video-mode-ffmpeg.spec.ts` edit and local-only `main` commits remain untouched.
- 2026-07-24: Added the single regression as a red-to-green slice. The default path now yields clear/character input events while `typeFills: false` yields the original single fill event.
- 2026-07-24: Visual review found the renderer's static highlight hold discarded action-time footage. Rewritten fills now mark their highlight as live: ffmpeg overlays the real typed field pixels on the stable pre-action screenshot, retaining character entry without replaying unrelated page effects.
- 2026-07-24: The first full run after the renderer follow-up missed an existing concurrent frame-count assertion by one frame (`3` versus `2` allowed). It passed immediately in isolation; the next full run passed 75 tests with 3 provider-gated skips.
- 2026-07-24: Captured matching 7.7-second baseline and 7.5-second changed account-flow videos from `origin/main` and this branch. Sequential frame review shows the baseline hold remains empty while the changed hold advances through the email one or two characters per 10 fps sample.
