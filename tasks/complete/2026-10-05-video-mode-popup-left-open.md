---
status: done
size: medium
---

# videoMode renders a popup that is left open wrongly

**Status summary**: done. All three symptoms came from the timeline calibration failing on a padded screencast, plus the popup having no notion of "the test went back to the opener". Fixed: cover detection ignores the recorder's padding, the wall→raw offset may be negative, a left-open popup slides away when the test returns to its opener (on a short freeze of the composite), and teardown no longer counts as test time. Nothing known missing; follow-ups listed at the bottom.

Seen recording a sign-in spec in another repo. The main page clicks a button inside an iframe, a popup opens, the test acts in the popup, then `page.reload()`s the main page and carries on there. The popup is never closed. Viewport 1280x900.

In `video-rendered.webm`:

- while the popup is shown, the background behind it is the main page's final frame (already signed in), not the main page as it was at that moment
- the popup overlay goes solid black for about a second before it closes
- the video ends on a black frame

Both raw recordings are fine on their own, so it is the composite step.

## Checklist

- [x] failing spec that mirrors the flow (popup left open, test goes back to the opener, 1280x900) _`spec/popup-video-left-open.spec.ts`: asserts the render's storyboard; a second test covers a popup still open at test end. Both fail on main with `"black"` scenes._
- [x] find out why the popup lands late on the main timeline _Playwright pads a 1280x900 screencast with a 2px gray strip (800x562 video). `detectCalibrationCoverStartMs` wanted every pixel to be cover, never matched, and calibration fell back to endpoint arithmetic: ~0.9s late here. Detection now crops to the screencast's own area._
- [x] find out why the popup's teardown footage (the calibration cover) reaches the render _Same failed detection (nothing capped the overlay before the popup's cover), plus `closedAt` and the render end being stamped after the popup's 1.1s recorder settle. The test end is now stamped by the first finalizer (`state.endedAt`); a popup closed by teardown keeps `closedAt` unset._
- [x] decide what the overlay does when the test goes back to the opener with the popup still open _It exits: slide-out at the first opener highlight after the popup's last one. The footage has no spare time for the animation (the opener action follows within ms), so the composite splices in a freeze (`VideoModeFreeze`) and everything downstream moves onto the composite clock. Self-closing popups exit the same way; the old "shift opener highlights past the fade" loop is gone._
- [x] todo-app baseline video still paces the same _20.5s before and after._

## Implementation notes

Log of what turned up along the way, not instructions.

- With detection working, the cover-based offset came out around -100ms, which the old code clamped to 0. It is real: the recorder's first frame lands ~100ms after videoMode's clock zero, so the opener's footage ran 100ms ahead of the popup and of every annotation. The clamp is gone.
- Removing the clamp made frame-exact specs flaky (`holds the pre-click state…`, `does not calibrate against an earlier occurrence…`). They run at 800x600, which is also padded, so on main they had been on the endpoint fallback all along, which reads early. The cover reading can come out a frame late under load. The offset is now the earlier of the two readings: each fails late in its own way (cover frame reaching the screencast late; endpoint a second out when the page animates at close), and late is the harmful direction.
- Negative offsets put a popup that opened before the first recorded frame at composite time 0, on top of everything that happened before it. A popup now never starts on the first frame, and its footage from before time 0 is trimmed (left in, ffmpeg dropped the whole overlay).
- Chrome paints "Debugger paused in another tab" over the opener while Playwright holds a newborn popup paused. It sometimes reaches the screencast; when it was the first frame, pre-footage annotations held it. The composite now drops the opener's frames around a popup's birth.
- A popup's last highlight can be within a frame of teardown. Popup holds freeze composite footage (no screenshot stand-in), so the popup recorder now waits until that state has been on screen 150ms before covering it, and every projected popup highlight gets a source slice inside the overlay window.
- `spec/video-mode-ffmpeg.spec.ts` "returns from an offscreen blur pan…" fails now and then under heavy parallel load (once in a 3x full-suite run), on main too: the recording captured nothing but the cover.

## Follow-ups (not done)

- The popup backdrop desaturates the page as well as dimming it (`drawbox` blends chroma once per luma pixel in yuv420).
- A popup still open at the end is cut away at the final hold: the final frame is a screenshot of the opener alone.
- Step captions blank for the length of an exit freeze when one step ends before it and the next starts after.
- Popup recordings are still calibrated from the cover alone; the opener's two-reading rule isn't applied to them.
