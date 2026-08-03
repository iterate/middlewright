---
status: complete
size: large
---

# Isolate synthetic dialog capture from the recorded page

## Status

Complete on draft PR #18. Dialog artwork now comes from a separate video-disabled capture page, FFmpeg composites it over the last clean pre-dialog application frame, the raw video stays untouched, frame-sequence regressions are stable, and two native review videos are attached.

## Goal

Never insert or stage Middlewright's synthetic alert, confirm, or prompt UI in the application page being recorded. Build the dialog scene in a separate video-disabled Playwright page from real `Dialog` metadata and the intercepted accept/dismiss result, then render a clean raw → wholly synthetic dialog → raw sequence.

## Assumptions

- This fix targets `main` directly and does not depend on the pending wait-for highlight work.
- The application page supplies only the frozen background frame and real dialog timing; it never contains Middlewright dialog artwork.
- A lazily-created video-disabled capture page at the application's viewport can produce the same browser-quality transparent dialog layers without delaying the native dialog interaction beyond the existing capture work.
- Alert, confirm, and prompt behavior remains Playwright-native, including automatic dismissal when the plugin is the sole listener and existing listener ordering.
- No public option is needed.

## Ranked hypotheses

1. **Live capture-state leakage is the primary cause.** If the fake dialog is never attached to the recorded page, decoded raw frames will contain no synthetic dialog pixels and the rendered prompt cannot show selected-blue before neutral white.
2. **The 31 ms raw bridge exposes the accepted staging frame after 25 fps quantisation.** If the entire dialog interval is replaced by a synthetic scene beginning from the dialog-open frozen background, varying the sub-frame resolution timing will not restore the early blue frame.
3. **Input-only fill stabilisation leaves unrelated pixels from the raw staging frame.** If the whole synthetic dialog scene is composited as one layer over a clean frozen background, button state will be determined solely by the dialog phase rather than the input crop.
4. **FFmpeg independently reorders decoded frames.** If this is the cause, moving dialog capture off-page while keeping the same timing/filter graph will leave the blue → white transition; this is ranked low because the raw recording already shows the transition in chronological order.

## Checklist

- [x] Add a failing public rendered-video regression for neutral white → progressive prompt text with white OK → one final blue OK transition. *Commit `747a044` scanned the whole decoded transition and failed against the live-DOM staging path.*
- [x] Prove the matching raw video contains no Middlewright dialog artwork or staging state. *The prompt regression decodes the raw recording and rejects every synthetic white-panel frame.*
- [x] Render synthetic dialogs in a separate video-disabled Playwright page/context at the application viewport. *`createVideoModeDialogRenderer` lazily owns the isolated context and transparent layer captures.*
- [x] Build dialog annotations from Playwright `Dialog` metadata and intercepted accept/dismiss results. *The existing Playwright observer now supplies type, message, default value, chosen action, and accepted prompt text directly.*
- [x] Replace every raw frame in the dialog interval with a frozen application background plus synthetic dialog phases. *Dialog highlights start at dialog-open, freeze the last preceding raw frame, and resume at the captured resolution timestamp.*
- [x] Remove the application-page `window.alert`/`confirm`/`prompt` monkeypatch and overlay staging. *The init script is gone; a MutationObserver regression proves the synthetic host never enters the application DOM.*
- [x] Cover alert, confirm, and prompt accept/dismiss/default-value behavior plus Playwright auto-dismiss/listener semantics. *Existing dialog behavior specs remain green; a rendered dismissed-prompt regression adds default-value and selected-Cancel coverage.*
- [x] Stress the focused frame-sequence regression and run FFmpeg specs, full suite, typecheck, build, and publint. *20/20 focused stress, 31/31 FFmpeg, 97 passing plus 3 provider-gated skips, and all static/package checks are green.*
- [x] Generate and inspect focused raw/rendered prompt media and, if practical, the todo raw/rendered pair. *Inspected focused contact sheets and MP4s; kept the independent main-based PR free of PR #15's todo fixture rather than copying pending code into it.*
- [x] Upload native GitHub video players, finish the PR body, complete this task, and start non-blocking review monitoring. *PR #18 contains verified rendered/raw GitHub players, the reviewer-oriented body, and an active foreground PR monitor during handoff.*

## Implementation log

- 2026-08-03: Created `fix/video-mode-isolated-dialog-capture` in a sibling worktree from `origin/main` (`0cae25f`) after PR #17 merged. Kept the work independent of PR #15.
- 2026-08-03: Recorded the diagnosis as ranked, falsifiable hypotheses before implementation. The first tracer bullet will scan the full decoded state-transition sequence rather than sample only hold middles.
- 2026-08-03: The RED tracer captured the transition leak. The correct hypothesis was live capture-state leakage amplified by the sub-frame raw bridge; FFmpeg itself preserved the staged order.
- 2026-08-03: Removed all application-page dialog injection. The isolated renderer captures RGBA layers, while FFmpeg reverses a short raw window to select the last frame before dialog-open, freezes it for each synthetic phase, and resumes at dialog resolution.
- 2026-08-03: Added the application-DOM invariant, raw-video invariant, accepted prompt sequence, and dismissed/default-value visual coverage. Existing alert, confirm, automatic dismissal, pre-registered listeners, and back-to-back dialogs remain green.
- 2026-08-03: Focused stress, the full FFmpeg suite, the full project suite, typecheck, build, and publint passed. Uploaded focused rendered/raw prompt MP4s and verified two native GitHub players in the PR body.
