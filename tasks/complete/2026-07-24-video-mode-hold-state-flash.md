---
status: in-progress
size: medium
base: pull/7
---

# Prevent post-action state flashing before video holds

## Status

Implementation complete; final PR media and CI are pending. Rendering now calibrates videoMode time against Playwright's settled raw endpoint, translates the full render timeline, and excludes the recorder's invented tail. The fixed 100 ms cutoff is gone; all 16 ffmpeg specs and repeated frame-order regressions pass.

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
- [x] Re-run focused video specs and the full validation suite. *40 focused video tests and 74 full-suite tests pass; 3 provider-gated tests skip. Typecheck, build, and publint pass.*
- [x] Regenerate and visually inspect the same three videos used by PR #7. *Serial final renders of the caption, dead-air, and dialog fixtures were inspected as timestamped contact sheets.*
- [x] Attach those three videos to the PR for direct comparison. *PR #9 renders exactly three inline GitHub video players.*
- [x] Document the expected interaction with PR #8 in the PR body. *A synthetic merge identified the `videoPieces()` conflict; the typed-fill, frame-ordering, and caption specs pass with the documented resolution.*
- [x] Reproduce every remaining state reversal in the three PR videos. *A native-rate audit exposed the more general mismatch: raw frames, annotation spans, and Playwright's synthetic recorder tail used different origins.*
- [x] Replace the fixed 100 ms guard with a measured video/annotation timeline mapping. *A known settled final paint calibrates the raw endpoint; captions, dead air, highlights, and explicit source ranges are translated together.*
- [x] Add a regression that covers the clock mapping rather than another larger cutoff. *The frame-ordering spec now also rejects the uncalibrated recorder tail; it failed at 2.08 s before calibration and passes around 1.48 s after it.*
- [ ] Regenerate and inspect every frame of the three comparison videos, then replace their PR attachments. *All frames of fresh local renders are clean; attachment replacement remains.*

## Implementation log

- 2026-07-24: Created `fix/video-mode-hold-state-flash` from PR #7 head `2c637b7`. Kept PR #8 out of the branch so its typed-fill change can be assessed independently.
- 2026-07-24: Reproduced the reported account-flow flash at 25 fps: the filled value appeared at 40 ms and 80 ms, then the pre-action screenshot resumed at 120 ms.
- 2026-07-24: A large blue-to-red click fixture made the signal deterministic. Before the fix, three runs each found 2–3 red frames before the blue pre-click hold.
- 2026-07-24: The same regression passed five consecutive runs after the fix. The original account flow was regenerated and its first 1.2 seconds inspected as a contact sheet; the input remains empty until the real post-hold action footage.
- 2026-07-24: All 16 ffmpeg video-mode specs pass on the implementation.
- 2026-07-24: The focused video-mode suite passed 40/40. The full suite passed 74 tests with 3 provider-gated skips; typecheck, build, and publint passed.
- 2026-07-24: A synthetic merge with PR #8 required a manual `videoPieces()` resolution because both branches change the highlight source window. Keeping the 100 ms cutoff while preserving `liveAction` through `actionEnd` passed the relevant three specs.
- 2026-07-24: Uploaded the same caption, dead-air, and dialog videos as PR #7 to PR #9. GitHub's rendered body contains three inline video players.
- 2026-07-24: Reopened after review still found visible flashes. The fixed cutoff and sampled contact-sheet inspection are no longer considered a complete fix.
- 2026-07-24: Read Playwright 1.60's recorder implementation. Its WebM clock begins at the first browser screencast frame and its final frame is extended by at least one second; neither boundary is videoMode's Node monotonic origin.
- 2026-07-24: Replaced the guessed lead-in with endpoint calibration. Finalization paints a frame outside the render range, lets the recorder settle, measures the raw/annotation offset at close, translates all render inputs, and trims the calibration plus synthetic recorder tail.
- 2026-07-24: The strengthened regression failed before calibration because a 1.28 s raw video became a 2.08 s render; the calibrated render is about 1.48 s and preserves the pre-click hold followed by the red post-click state. Five repeated runs passed.
- 2026-07-24: All 16 ffmpeg specs pass. A native 25 fps audit of the caption, dead-air, and dialog renders found no completed-state → pre-action-state → completed-state reversals.
