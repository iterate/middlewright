---
status: in-progress
size: large
---

# Isolate synthetic dialog capture from the recorded page

## Status

Starting from `origin/main`. The reported blue → white → blue prompt flicker is reproduced conceptually from the existing hybrid capture path; the public frame-sequence regression, isolated renderer, full validation, and review videos remain.

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

- [ ] Add a failing public rendered-video regression for neutral white → progressive prompt text with white OK → one final blue OK transition. *Pending.*
- [ ] Prove the matching raw video contains no Middlewright dialog artwork or staging state. *Pending.*
- [ ] Render synthetic dialogs in a separate video-disabled Playwright page/context at the application viewport. *Pending.*
- [ ] Build dialog annotations from Playwright `Dialog` metadata and intercepted accept/dismiss results. *Pending.*
- [ ] Replace every raw frame in the dialog interval with a frozen application background plus synthetic dialog phases. *Pending.*
- [ ] Remove the application-page `window.alert`/`confirm`/`prompt` monkeypatch and overlay staging. *Pending.*
- [ ] Cover alert, confirm, and prompt accept/dismiss/default-value behavior plus Playwright auto-dismiss/listener semantics. *Pending.*
- [ ] Stress the focused frame-sequence regression and run FFmpeg specs, full suite, typecheck, build, and publint. *Pending.*
- [ ] Generate and inspect focused raw/rendered prompt media and, if practical, the todo raw/rendered pair. *Pending.*
- [ ] Upload native GitHub video players, finish the PR body, complete this task, and start non-blocking review monitoring. *Pending.*

## Implementation log

- 2026-08-03: Created `fix/video-mode-isolated-dialog-capture` in a sibling worktree from `origin/main` (`0cae25f`) after PR #17 merged. Kept the work independent of PR #15.
- 2026-08-03: Recorded the diagnosis as ranked, falsifiable hypotheses before implementation. The first tracer bullet will scan the full decoded state-transition sequence rather than sample only hold middles.
