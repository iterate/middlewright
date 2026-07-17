---
status: in-progress
size: medium
---

# Show Playwright dialogs in video mode

## Status

Just started. The native-dialog omission is understood, but the repro, synthetic dialog rendering, tests, documentation, and before/after media are still outstanding.

## Goal

Make `videoMode` recordings show alert, confirm, and prompt interactions even though Chromium's native dialog UI is outside the page video surface. Preserve real Playwright dialog behavior; the synthetic dialog exists only in the rendered artifact.

## Assumptions

- Dialog display is enabled whenever video annotations are enabled; no new consumer option is needed for the first version.
- The rendered dialog should show the dialog type, message, prompt default/accepted text, and the button actually chosen by the test.
- Dialog holds and cursor movement belong in post-processing so normal test execution stays fast.
- Before/after recordings should use the same deterministic fixture and be attached to the pull request.

## Checklist

- [ ] Capture a deterministic baseline recording proving native dialogs are absent from the raw/rendered video.
- [ ] Add a failing public-behavior spec for dialog metadata and rendered-video visibility.
- [ ] Observe Playwright dialog resolution without changing whether the test accepts, dismisses, or supplies prompt text.
- [ ] Render a synthetic alert/confirm/prompt frame with a readable message and prompt value.
- [ ] Pause on the synthetic dialog and animate the video-mode cursor to the chosen button; show prompt entry before confirmation.
- [ ] Cover alert acceptance, confirm acceptance/dismissal, and prompt text in tests.
- [ ] Document video-mode dialog behavior and any limitations.
- [ ] Run build, typecheck, and focused/full tests.
- [ ] Attach matching before/after videos to the pull request and update its reviewer-oriented body.

## Implementation log

- 2026-07-17: Worktree created from `origin/main` at `fix/video-mode-dialogs`. Initial investigation found that video mode only observes locator middleware and Chromium page videos do not include browser-native dialogs.
