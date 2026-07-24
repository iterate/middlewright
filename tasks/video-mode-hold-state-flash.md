---
status: in-progress
size: medium
base: pull/7
---

# Prevent post-action state flashing before video holds

## Status

Specified and ready for diagnosis. The worktree is based on PR #7 so its three videos can be regenerated for direct comparison. Reproduction, regression coverage, the runtime fix, and rendered-video validation remain.

## Goal

Rendered videos must not briefly show an action's completed page state before the synthetic hold for that action. A hold should show the pre-action state while the pointer moves to the target, then allow the real recorded action to change the page once.

## Reported symptom

In PR #7's “turns meaningful Playwright steps into readable video captions” video:

1. The Work email input starts empty.
2. It briefly contains `ada@example.com`.
3. It becomes empty again for the pointer hold.
4. The pointer reaches the input and the value appears again.

Equivalent post-action/pre-hold flashes are visible in the other PR #7 videos.

## Assumptions

- The bug is in post-rendered hold composition, not browser recording.
- `video-raw.webm` is the source of truth for real page state changes; synthetic hold pieces may repeat a frame but must not reorder visible states.
- Existing hold duration, pointer movement, captions, dead-air compression, and dialog rendering behavior should remain unchanged.
- The regression should inspect actual rendered frames at the action/hold boundary rather than only metadata or filter strings.
- This branch will stay based on `test/simplify-video-fixtures` / PR #7.
- PR #8 changes short `fill()` actions into typing. That can change the fill video's expected motion after the hold, but it should not change the invariant that no completed state appears before the hold. The PR body will call out the likely merge/testing impact without merging #8 now.
- The PR will include regenerated versions of the same three videos attached to PR #7.

## Checklist

- [ ] Build a deterministic frame-level reproduction of the post-action/pre-hold flash.
- [ ] Rank and test plausible causes in the rendered timeline/filter construction.
- [ ] Add a failing public-behavior regression spec for the visible state ordering.
- [ ] Fix hold composition without coupling video mode to another plugin.
- [ ] Re-run focused video specs and the full validation suite.
- [ ] Regenerate and visually inspect the same three videos used by PR #7.
- [ ] Attach those three videos to the PR for direct comparison.
- [ ] Document the expected interaction with PR #8 in the PR body.

## Implementation log

- 2026-07-24: Created `fix/video-mode-hold-state-flash` from PR #7 head `2c637b7`. Kept PR #8 out of the branch so its typed-fill change can be assessed independently.
