---
status: in-progress
size: medium
base: pull/7
---

# Prevent post-action state flashing before video holds

## Status

About 70% complete. A deterministic frame-level regression now covers the flash, and the renderer replaces the recorder's lagging pre-action tail with the captured pre-action frame. All 16 ffmpeg specs pass. Full-suite validation, #8 compatibility, and the three comparison video uploads remain.

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

- [x] Build a deterministic frame-level reproduction of the post-action/pre-hold flash. *The rendered color-transition fixture consistently exposed 2–3 completed-state frames before its pre-click hold.*
- [x] Rank and test plausible causes in the rendered timeline/filter construction. *Raw-frame inspection showed the completed paint already timestamped 80–100 ms before the wall-clock action boundary; concat and screenshot ordering were ruled out.*
- [x] Add a failing public-behavior regression spec for the visible state ordering. *The calibrated highlight spec now decodes the rendered output and rejects any completed-state frame before the hold.*
- [x] Fix hold composition without coupling video mode to another plugin. *Highlight timing starts before capture, and the final 100 ms before an action is replaced by its known pre-action screenshot.*
- [ ] Re-run focused video specs and the full validation suite.
- [ ] Regenerate and visually inspect the same three videos used by PR #7.
- [ ] Attach those three videos to the PR for direct comparison.
- [ ] Document the expected interaction with PR #8 in the PR body.

## Implementation log

- 2026-07-24: Created `fix/video-mode-hold-state-flash` from PR #7 head `2c637b7`. Kept PR #8 out of the branch so its typed-fill change can be assessed independently.
- 2026-07-24: Reproduced the reported account-flow flash at 25 fps: the filled value appeared at 40 ms and 80 ms, then the pre-action screenshot resumed at 120 ms.
- 2026-07-24: A large blue-to-red click fixture made the signal deterministic. Before the fix, three runs each found 2–3 red frames before the blue pre-click hold.
- 2026-07-24: The same regression passed five consecutive runs after the fix. The original account flow was regenerated and its first 1.2 seconds inspected as a contact sheet; the input remains empty until the real post-hold action footage.
- 2026-07-24: All 16 ffmpeg video-mode specs pass on the implementation.
