---
status: ready
size: medium
---

# videoMode renders a popup that is left open wrongly

Seen recording iterate/private's `test/playwright/ui/sign-in.spec.ts` (branch `nobuild-pages-sign-in`), test "a page in a jsfiddle signs in…". The main page clicks a button inside an iframe, a popup opens, the test acts in the popup, then `page.reload()`s the main page and carries on there. The popup is never closed. Viewport 1280x900.

In `video-rendered.webm`:

- while the popup is shown, the background behind it is the main page's final frame (already signed in), not the main page as it was at that moment
- the popup overlay goes solid black for about a second before it closes
- the video ends on a black frame

Both raw recordings are fine on their own, so it is the composite step.

## Checklist

- [ ] failing spec that mirrors the flow (popup left open, test goes back to the opener, 1280x900)
- [ ] find out why the popup lands late on the main timeline
- [ ] find out why the popup's teardown footage (the calibration cover) reaches the render
- [ ] decide what the overlay does when the test goes back to the opener with the popup still open
- [ ] todo-app baseline video still paces the same
