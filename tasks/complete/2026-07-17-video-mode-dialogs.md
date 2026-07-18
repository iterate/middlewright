---
status: complete
size: medium
---

# Show Playwright dialogs in video mode

## Status

Complete. Dialog synthesis, pointer actions, and one-second post-dialog pacing are implemented and documented; local validation, CI, reviews, consumer proof, and refreshed inline videos are green.

## Goal

Make `videoMode` recordings show alert, confirm, and prompt interactions even though Chromium's native dialog UI is outside the page video surface. Preserve real Playwright dialog behavior; the synthetic dialog exists only in the rendered artifact.

## Assumptions

- Dialog display is enabled whenever video annotations are enabled; no new consumer option is needed for the first version.
- The rendered dialog should show the dialog type, message, prompt default/accepted text, and the button actually chosen by the test.
- Dialog holds and cursor movement belong in post-processing so normal test execution stays fast.
- Before/after recordings should use the same deterministic fixture and be attached to the pull request.

## Checklist

- [x] Capture a deterministic baseline recording proving native dialogs are absent from the raw/rendered video. *Saved matching 960×540 before/after WebM artifacts from the discard-confirm fixture under the ignored media workspace.*
- [x] Add a failing public-behavior spec for dialog metadata and rendered-video visibility. *The first confirm spec failed on the missing dialog annotation; the ffmpeg spec verifies a visible paused panel and pointer target.*
- [x] Observe Playwright dialog resolution without changing whether the test accepts, dismisses, or supplies prompt text. *The plugin wraps each emitted Dialog's real accept/dismiss methods and preserves Playwright's no-listener auto-dismiss behavior.*
- [x] Render a synthetic alert/confirm/prompt frame with a readable message and prompt value. *An init-script overlay is captured only for post-processing, then removed immediately.*
- [x] Pause on the synthetic dialog and animate the video-mode cursor to the chosen button; show prompt entry before confirmation. *Prompt acceptance records a fill-target frame followed by a filled-value/button-target frame.*
- [x] Cover alert acceptance, confirm acceptance/dismissal, and prompt text in tests. *Coverage lives in `spec/video-mode.spec.ts`.*
- [x] Document video-mode dialog behavior and any limitations. *README documents artifact-only synthesis and the unsupported beforeunload case.*
- [x] Run build, typecheck, and focused/full tests. *Typecheck, build, publint, and 64 passing tests completed locally (3 provider-gated tests skipped).*
- [x] Attach matching before/after videos to the pull request and update its reviewer-oriented body. *Uploaded both WebM clips through GitHub's authenticated attachment flow; the PR body renders two inline video players.*
- [x] Make the confirm rendering spec visibly finish on “Discarded!”, wait for it, and replace both middlewright PR videos. *The fixture renders the accepted result and waits for the exact visible text as an outcome assertion; pacing no longer relies on a test delay or configured final hold.*
- [x] Serialize back-to-back dialog highlight capture so one dialog cannot replace another's synthetic overlay during recording. *Capture order is reserved before native resolution, synthetic hosts are isolated one at a time, and the regression verifies both generated screenshots remain readable and ordered.*
- [x] Record Playwright's automatic dismissal of an unhandled alert against the alert's sole OK control. *Native auto-dismiss behavior remains unchanged; recording metadata and the pointer normalize that closure to alert acknowledgement.*
- [x] Guarantee at least one second of clean post-dialog video, extending the final page frame only when natural footage is shorter. *Rendered-time calculation respects dead-air compression; short tails append only the missing duration from a clean final screenshot, while a regression proves long natural tails are unchanged.*

## Implementation log

- 2026-07-17: Worktree created from `origin/main` at `fix/video-mode-dialogs`. Initial investigation found that video mode only observes locator middleware and Chromium page videos do not include browser-native dialogs.
- 2026-07-17: Confirmed the baseline rendered video jumps from the highlighted discard action directly to its result. Implemented an in-page dialog bridge that leaves the native Playwright interaction authoritative while capturing a synthetic post-processing frame.
- 2026-07-17: Prompt recording now emits a text-input phase with the default value and a decision phase with the supplied value. The existing cursor planner supplies the text and click pointers without adding real-time holds to the test.
- 2026-07-17: Middlewright CI passed and published `https://pkg.pr.new/middlewright@4` at commit `2cb2a4e`. Iterate PR #2098 consumed that artifact and its unchanged IDE discard spec produced visible Cancel and OK dialog phases.
- 2026-07-17: Added coverage for synchronous dialog handlers registered before `addPlugins`; video mode now prepends its observer so registration order cannot skip annotation or trigger a second automatic dismissal.
- 2026-07-17: Uploaded matching before/after recordings to PR #4, verified GitHub rendered both as inline `<video>` players, and completed the reviewer-oriented PR body.
- 2026-07-17: Review follow-up requested a visible post-dialog “Discarded!” state in the confirm proof and refreshed matching videos.
- 2026-07-17: Added the visible result and exact `waitFor()`, regenerated the baseline and dialog-aware recordings from the matching fixture, visually checked the dialog and final frames, and replaced both inline PR videos through Playwriter.
- 2026-07-17: Cursor Bugbot identified a credible race when page JavaScript opens another dialog immediately after accepting the first; added it as a release-blocking review follow-up.
- 2026-07-17: Reproduced the race, serialized/isolate queued captures in commit `4e750a1`, replied to and resolved the review thread, and removed the pickup reaction. Typecheck, build, publint, and the 62-pass suite are green.
- 2026-07-17: Bugbot re-review identified that automatic alert dismissal records a nonexistent Cancel target; added a focused release-blocking follow-up.
- 2026-07-17: Added a failing no-listener alert spec, normalized its recorded action to OK acknowledgement in commit `1d5104f`, then replied to/resolved the thread and removed the pickup reaction. The 63-pass suite is green.
- 2026-07-17: Follow-up requested system-level post-dialog pacing so Iterate and other consumers do not need scenario-specific sleeps or `finalHold` settings.
- 2026-07-17: Added failing-first ffmpeg coverage for short and naturally sufficient tails, then implemented renderer-owned one-second post-roll in commit `3e00f54`. The no-delay/`finalHold: 0` fixture ends visibly on “Discarded!” and the full 64-pass suite is green.
- 2026-07-17: Published immutable preview `https://pkg.pr.new/middlewright@3e00f54`; Iterate PR #2098's unchanged IDE discard spec generated the clean final-page extension and passed. Replaced both PRs' after clips through Playwriter and verified each body has two inline video players.
