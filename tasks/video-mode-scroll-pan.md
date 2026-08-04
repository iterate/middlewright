---
status: in-review
size: medium
---

# Pan to offscreen elements in video mode

## Status

Implementation complete and green: waitFor pans (down, hold, back), action pans (down, hold, stay at the browser's real scroll destination), horizontal axis, and the inner-scroll-container fallback. Full suite 106 passed, typecheck/build/publint clean. PR #22 has before/after demo videos plus the todo-app baseline. Remaining: review feedback.

## Goal

When a highlighted locator points at an element outside the viewport, the rendered video should show it: a smooth synthetic camera pan down (or up/sideways) to the element, the usual highlight hold there, then back to live footage. The browser test itself must not scroll or mutate any page state — the pan is fabricated in post from a passively captured tall screenshot, consistent with video mode's existing philosophy of recording facts at runtime and manufacturing effects at render time.

Today, `getByText(...).waitFor()` on an element below the fold records a viewport-relative rect outside the frame and a viewport screenshot that doesn't contain the element, so the hold shows nothing useful. Playwright deliberately doesn't scroll for `waitFor`, and we don't want it to.

## Assumptions

- No in-test scrolling, ever. `scrollIntoView`/`scrollIntoViewIfNeeded` changes real page state (lazy-loading, IntersectionObservers, sticky headers, subsequent action geometry). Instead capture a beyond-viewport screenshot at highlight time — Chromium's `captureBeyondViewport` renders offscreen content without scrolling. Verify non-mutation in the spec by asserting the live page's scroll position is unchanged and the raw recording never shows the offscreen content. *Measured during implementation: no scroll event, no IntersectionObserver firing, no media-query flip; the page observes only a no-op `resize` event with unchanged dimensions, and Chromium leaks one zoomed-out frame into the screencast, which the renderer excises.*
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
- The raw recording contains no frames showing the offscreen element; the rendered video does. The page's scroll position is unchanged after the wait. *Amended: the raw recording contains one shrunken full-document flash frame from the beyond-viewport capture; the spec asserts the element never appears at real size in raw footage and the flash never reaches the rendered video.*
- A click on an offscreen element pans down to its pre-action highlight and continues into the post-scroll live footage without stale or jumping frames.
- Elements clipped by an inner scrollable container keep today's behavior.
- The PR body has clearly labelled before/after renders of the same offscreen-wait fixture (before = main, after = this branch), plus the standard todo-app baseline render and raw recording.

## Checklist

- [x] Add a failing public-behavior FFmpeg spec: a below-the-fold element revealed by `waitFor()` must appear in the rendered video while the raw recording never shows it and the live page never scrolls. *`pans to an offscreen waitFor result without scrolling the live page` — failed on the offscreen rect, now asserts pan motion, outlined hold, flash excision, and pan-back.*
- [x] Record pan facts at highlight time: beyond-viewport clipped screenshot, document rect, current scroll, pan destination, inner-scroll-container guard. *`recordHighlight` gained a `pan: "off" | "return" | "stay"` mode; capture uses `page.screenshot({ clip, fullPage: true })` — plain `clip` cannot exceed the viewport, `fullPage + clip` can.*
- [x] Render the pan: eased crop over the tall still, highlight hold at the panned-to rect, pan back for `waitFor`, correct rendered-duration accounting. *A pan branch in `renderedVideoFilter` animates `crop` x/y with cosine-eased time expressions; `renderedPieceDuration` adds one or two pan legs; the pan piece consumes the capture-flash span from the source.*
- [x] Extend to pre-action highlights for scrolling actions (click on offscreen element): pan down, hold, resume post-scroll footage without stale frames. *"stay" pans capture one extra viewport beyond the estimated destination, then `finalizePanHighlightAfterAction` adopts the browser's actual scroll so the pan lands pixel-exact on resumed footage (Chromium centers, which the estimate cannot know).*
- [x] Cover the inner-scroll-container fallback and horizontal pan with focused specs. *Two metadata specs in video-mode.spec.ts; the render path is axis-symmetric.*
- [x] Update the video-mode README with the new behavior and known limitations (frozen animations, sticky/fixed slide). *"Panning to offscreen elements" subsection under highlighting.*
- [x] Run focused FFmpeg specs, the full suite, typecheck, build, publint. *106 passed, 4 provider-gated skips; typecheck, build, publint clean.*
- [x] Generate before/after renders of the offscreen-wait fixture plus the todo-app baseline (rendered + raw), inspect frame-by-frame, and attach all to the PR body with labels. *A gitignored deploy-log demo spec rendered on main and on this branch; frames inspected; five labelled videos attached to PR #22.*

## Implementation log

- 2026-08-04: Task fleshed out from the user's ask ("have video mode scroll down to show elements that are not visible... doing nothing significant in-test") plus a design discussion that settled on beyond-viewport screenshots + synthetic pan over in-test `scrollIntoView`.
- 2026-08-04: Verified the capture mechanism empirically before wiring anything: `page.screenshot({ clip })` beyond the viewport errors, but `fullPage: true` with a document-coordinate `clip` captures below-the-fold pixels exactly, with `scrollY` unchanged and no scroll event.
- 2026-08-04: RED spec failed on the recorded offscreen rect. First GREEN attempt failed differently: the raw screencast contained magenta — Chromium implements `captureBeyondViewport` by momentarily resizing the renderer, leaking one zoomed-out full-document frame. Measured page-observable effects: only a no-op `resize` event (unchanged dimensions); no scroll, no IntersectionObserver, no media-query change, so lazy-loading cannot trigger.
- 2026-08-04: Excised the flash by making the pan piece consume the capture span from the source via `actionEnd` plus a 150ms settle margin. The pan's first and last synthetic frames are pixel-identical to the live from-window footage, so the cut boundaries are invisible.
- 2026-08-04: The combined run exposed a pre-existing race: a selector-driven `trimStart` resolves over the protocol and can land 1-2ms after a highlight recorded at effectively the same moment, silently dropping that highlight (`videoPieces` filters `highlight.start >= segment.start`). Main passed 3/3 by microtiming luck; this branch's heavier snapshot evaluate flipped the coin (2/3 failing, 100% correlated with `start < sourceRange.start`). Fixed by moving a trim start that lands within one source frame after a highlight start back to that highlight; the affected text-cursor spec passes 8/8.
- 2026-08-04: Slice 2 (click pans that stay): Chromium centers the element rather than scrolling minimally, confirming the post-action adopt-actual-scroll design — the estimate alone would have misaligned the outline against the footage. The demo frames show the pan landing exactly where post-click footage resumes.
- 2026-08-04: Media: a gitignored deploy-log fixture (34 log rows, success card + summary button below the fold) rendered on main ("before": pointer drifts at the top pointing at nothing, footage jump-cuts after the click) and on this branch ("after": two smooth pans). Attached with the todo-app baseline (21.8s, no pans triggered — everything fits the viewport) and its raw recording.
