---
status: in-review
size: medium
---

# Pan to offscreen elements in video mode

## Status

Implementation is back in review follow-up: the main pan paths, narrow raw/rendered comparison, and merged-main validation are green, but an offscreen `blur()` exposes a missing return path when an action leaves the live scroll unchanged. A failing rendered-video regression and proof clip capture the bug. Remaining: make that action pan show the target and return to live footage, then rerun validation.

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
- [x] Generate before/after renders of the offscreen-wait fixture plus the todo-app baseline (rendered + raw), inspect frame-by-frame, and attach all to the PR body with labels. *A deploy-log demo rendered on main and on this branch; frames inspected; five labelled videos attached to PR #22.*
- [x] Make the demo reviewable: multiple pans in both directions and check it in as a real spec. *`spec/scroll-pan-demo.spec.ts` asserts live scroll positions after each wait/click pair and the recorded pan modes; comments keep the raw-vs-rendered distinction clear without obscuring the PR video with captions.*
- [x] Stop adjacent pans from yo-yoing. *A return pan directly followed by another pan skips its back leg and hands the camera over; the next pan enters from the previous destination (zero travel when equal). FFmpeg spec: once the awaited element is on camera it stays on camera through the click.*
- [x] Center pan destinations. *Matches Chromium's scroll-for-action alignment so wait-then-act pairs land on the same view, and keeps held elements out of the caption band (the bottom-aligned minimal scroll parked targets exactly under the captions).*
- [x] Match the todo demo's narrow viewport and replace the separate review clips with a raw/rendered side-by-side. *The checked-in scroll demo now uses 480×720; PR media pairs the fresh recordings in one labelled comparison video.*
- [ ] Return from an offscreen action pan when the action leaves the browser scroll unchanged. *Red FFmpeg repro uses an offscreen focused field's `blur()`: the live page stays at the top, but the broken renderer collapses the estimated destination to that scroll and never shows the field.*

## Implementation log

- 2026-08-04: Task fleshed out from the user's ask ("have video mode scroll down to show elements that are not visible... doing nothing significant in-test") plus a design discussion that settled on beyond-viewport screenshots + synthetic pan over in-test `scrollIntoView`.
- 2026-08-04: Verified the capture mechanism empirically before wiring anything: `page.screenshot({ clip })` beyond the viewport errors, but `fullPage: true` with a document-coordinate `clip` captures below-the-fold pixels exactly, with `scrollY` unchanged and no scroll event.
- 2026-08-04: RED spec failed on the recorded offscreen rect. First GREEN attempt failed differently: the raw screencast contained magenta — Chromium implements `captureBeyondViewport` by momentarily resizing the renderer, leaking one zoomed-out full-document frame. Measured page-observable effects: only a no-op `resize` event (unchanged dimensions); no scroll, no IntersectionObserver, no media-query change, so lazy-loading cannot trigger.
- 2026-08-04: Excised the flash by making the pan piece consume the capture span from the source via `actionEnd` plus a 150ms settle margin. The pan's first and last synthetic frames are pixel-identical to the live from-window footage, so the cut boundaries are invisible.
- 2026-08-04: The combined run exposed a pre-existing race: a selector-driven `trimStart` resolves over the protocol and can land 1-2ms after a highlight recorded at effectively the same moment, silently dropping that highlight (`videoPieces` filters `highlight.start >= segment.start`). Main passed 3/3 by microtiming luck; this branch's heavier snapshot evaluate flipped the coin (2/3 failing, 100% correlated with `start < sourceRange.start`). Fixed by moving a trim start that lands within one source frame after a highlight start back to that highlight; the affected text-cursor spec passes 8/8.
- 2026-08-04: Slice 2 (click pans that stay): Chromium centers the element rather than scrolling minimally, confirming the post-action adopt-actual-scroll design — the estimate alone would have misaligned the outline against the footage. The demo frames show the pan landing exactly where post-click footage resumes.
- 2026-08-04: Media: a gitignored deploy-log fixture (34 log rows, success card + summary button below the fold) rendered on main ("before": pointer drifts at the top pointing at nothing, footage jump-cuts after the click) and on this branch ("after": two smooth pans). Attached with the todo-app baseline (21.8s, no pans triggered — everything fits the viewport) and its raw recording.
- 2026-08-04: Review follow-up narrowed the checked-in demo from 800×600 to the todo app's 480×720 viewport, removed its `test.step` captions, and combined its newly generated raw and rendered recordings side by side for the PR body; the old before-rendered comparison is no longer needed.
- 2026-08-04: Review feedback: the demo was confusing — the waitFor pan returned to the top only for the click pan to travel straight back down, and the demo spec was gitignored so its `test.step` code was invisible in the PR. Frame classification confirmed the yo-yo (2 frames at the top between pans). Added pan handover (suppress the return leg, enter the next pan from the previous destination), centered pan destinations (the bottom-aligned target sat exactly under the caption band), rebuilt the demo with four pans in both directions plus step captions, and checked it in as a real spec. The coalesced demo timeline is header → pan down → card (wait hold, handover, click, summary) → pan up → header for the badge wait and the copy click.
- 2026-08-05: Bugbot review found that `finalizePanHighlightAfterAction()` collapses a stay-pan destination when an action does not move the page. An offscreen `blur()` reproduces deterministically: runtime scroll remains zero, metadata rewrites the hold rect offscreen and keeps a 400ms minimum no-op pan, and rendered video never shows the magenta field. Added the failing public-video spec before changing production code.
