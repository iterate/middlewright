---
status: ready
size: medium
---

# Pan to offscreen elements in video mode

## Status

Spec written, implementation not started. Everything below the Goal is my (agent) best-guess fleshing-out of "have video mode scroll down to show elements that are not visible", decided AFK — see Assumptions for the judgement calls.

## Goal

When a highlighted locator points at an element outside the viewport, the rendered video should show it: a smooth synthetic camera pan down (or up/sideways) to the element, the usual highlight hold there, then back to live footage. The browser test itself must not scroll or mutate any page state — the pan is fabricated in post from a passively captured tall screenshot, consistent with video mode's existing philosophy of recording facts at runtime and manufacturing effects at render time.

Today, `getByText(...).waitFor()` on an element below the fold records a viewport-relative rect outside the frame and a viewport screenshot that doesn't contain the element, so the hold shows nothing useful. Playwright deliberately doesn't scroll for `waitFor`, and we don't want it to.

## Assumptions

- No in-test scrolling, ever. `scrollIntoView`/`scrollIntoViewIfNeeded` changes real page state (lazy-loading, IntersectionObservers, sticky headers, subsequent action geometry). Instead capture a beyond-viewport screenshot at highlight time — Chromium's `captureBeyondViewport` renders offscreen content without scrolling. Verify non-mutation in the spec by asserting the live page's scroll position is unchanged and the raw recording never shows the offscreen content.
- Trigger: the highlight target's rect is not fully inside the viewport at capture time. The pan destination is the minimal window scroll that brings it fully into view plus a small margin, mirroring `scrollIntoViewIfNeeded` semantics; elements larger than the viewport align top/left.
- Only window-level scrolling is handled. If a scrollable ancestor container (not the document) clips the element, window scroll wouldn't reveal it; keep current behavior there.
- The pan is a still-image effect: an eased crop window travelling over the tall screenshot. Frozen page animations during the pan are accepted (existing holds already freeze frames). `position: fixed`/`sticky` elements slide with the content during the pan — accepted and documented as a known limitation.
- Pan duration is distance-based with clamps, reusing the cursor-movement pacing constants' spirit; no new public options. `skipMethods` and `highlight: false` remain the opt-outs.
- `waitFor` pans down, holds, and pans back to the live scroll position, because the real page never moved. Pre-action highlights for scrolling actions (e.g. `click` on an offscreen element, which Playwright auto-scrolls) pan down and stay, because live footage resumes from the scrolled state. The `waitFor` case is the tracer bullet; the action case is a second slice.
- The tall capture is clipped to the span between the current scroll window and the pan destination (plus margin), not the whole document, so infinite-scroll pages don't produce enormous PNGs.
- Chromium only, like the screencast itself.
- Highlight metadata stores the final (panned-to) viewport-relative rect so the existing pointer/outline/cursor-plan machinery works unchanged; the pan carries its own from/to scroll offsets and image reference.

## Acceptance

- A `waitFor()` on an element below the fold renders as: live footage → smooth pan down → pointer/outline hold on the element → pan back → live footage, with no change to the test's runtime behavior or duration beyond the existing screenshot capture.
- The raw recording contains no frames showing the offscreen element; the rendered video does. The page's scroll position is unchanged after the wait.
- A click on an offscreen element pans down to its pre-action highlight and continues into the post-scroll live footage without stale or jumping frames.
- Elements clipped by an inner scrollable container keep today's behavior.
- The PR body has clearly labelled before/after renders of the same offscreen-wait fixture (before = main, after = this branch), plus the standard todo-app baseline render and raw recording.

## Checklist

- [ ] Add a failing public-behavior FFmpeg spec: a below-the-fold element revealed by `waitFor()` must appear in the rendered video while the raw recording never shows it and the live page never scrolls.
- [ ] Record pan facts at highlight time: beyond-viewport clipped screenshot, document rect, current scroll, pan destination, inner-scroll-container guard.
- [ ] Render the pan: eased crop over the tall still, highlight hold at the panned-to rect, pan back for `waitFor`, correct rendered-duration accounting.
- [ ] Extend to pre-action highlights for scrolling actions (click on offscreen element): pan down, hold, resume post-scroll footage without stale frames.
- [ ] Cover the inner-scroll-container fallback and horizontal pan with focused specs.
- [ ] Update the video-mode README with the new behavior and known limitations (frozen animations, sticky/fixed slide).
- [ ] Run focused FFmpeg specs, the full suite, typecheck, build, publint.
- [ ] Generate before/after renders of the offscreen-wait fixture plus the todo-app baseline (rendered + raw), inspect frame-by-frame, and attach all to the PR body with labels.

## Implementation log

- 2026-08-04: Task fleshed out from the user's ask ("have video mode scroll down to show elements that are not visible... doing nothing significant in-test") plus a design discussion that settled on beyond-viewport screenshots + synthetic pan over in-test `scrollIntoView`.
