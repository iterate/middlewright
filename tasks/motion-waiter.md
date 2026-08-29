---
status: in-progress
size: medium
---

# motion-waiter: don't click elements that are still sliding

## Status summary

Done pending review: plugin, demo spec (before/after), unit spec, exports,
README, and the PR body carries before/after + todo-app baseline videos.

## Problem

Playwright's actionability check only requires the target's bounding box to be
identical across TWO consecutive animation frames. Smooth CSS
transitions/animations move every frame, so Playwright waits for those — but
**timer-driven JS animation** (RN-web `Animated`'s JS driver, `setInterval`
steppers, legacy `$.animate`) steps coarser than the display refresh rate, so
plenty of consecutive frame pairs are identical mid-slide. Playwright declares
the element stable and clicks it while it's still moving.

Real-world hit (iterate repo, PR iterate/iterate#2547): a mobile drawer slides
in over ~180ms via RN Animated; the spec's click landed mid-slide, and
video-mode's click-moment freeze frame baked a half-open drawer into the
recording. The spec grew a hand-rolled motion probe (two `boundingBox()`
samples 120ms apart), which review deleted with "let the video suffer — we'll
fix it in middlewright if we care to". This is that fix.

## Decisions (assumptions made while fleshing out)

- **New plugin, not a spinner-waiter feature.** Motion is a distinct
  cross-cutting concern (AGENTS.md plugin boundaries); spinner-waiter owns
  loading UI, motion-waiter owns kinetics.
- **Detect motion by sampling the target's bounding box over time**, not by
  enumerating techniques (`getAnimations()` misses JS-driven motion — the very
  case that bit us). Box sampling is technique-agnostic: CSS
  transitions/animations, WAAPI, rAF steppers, and timer steppers all move the
  box. Opacity-only fades deliberately don't engage it (clicking a fading
  element is harmless).
- **Pointer actions only** (`click`, `dblclick`, `hover`) — the actions where
  a moving target produces a mis-click or an ugly click-moment frame.
- **Budgeted, never blocking**: 1.5s `settleTimeout` default (judgement call:
  it's a cap only paid for perpetual motion; typical cost is
  motion-duration + 150ms); perpetual motion proceeds at the deadline with a
  log line, and a subsequent action failure gets a still-moving hint appended.
- **A real stillness window, always**: the action proceeds only once the box
  has been observed holding still for `settledFor` (150ms) — ~150-200ms per
  pointer action on static elements. Deliberately NOT a single confirming
  sample: an element often sits parked a frame or two before its animation
  starts (React Native's open → requestAnimationFrame → animate shape — the
  motivating bug), and a zero-quiet fast path would sail right through that
  parked window. Step cadences slower than `sampleInterval` can still pass
  (documented boundary, same as vanilla Playwright).
- **Escape hatches match spinner-waiter**: `settings.run({ disabled: true })`
  per block, an author-passed explicit `{ timeout }` passes straight through
  (which also makes `[spinnerWaiter(), motionWaiter()]` compose: the
  fast-fail's injected 1ms timeout skips the inner motion wait), `PWDEBUG`
  disables the plugin.

## Checklist

- [x] Repro demo: a slow (700ms) timer-driven sliding drawer app +
      `spec/motion-drawer-demo.spec.ts` where the un-helped click provably
      lands mid-slide, for the "before" video _— control click lands at
      translateX −225px of a 280px drawer (≈20% open); the app records the
      offset at click time, freezes the slide with a pressed-item flash so the
      stranded drawer is visible on video, and the tests caption the videos
      via `page.videoMode.caption`_
- [x] `src/plugins/motion-waiter.ts`: the plugin per the decisions above
- [x] "after" demo test: same app with `motionWaiter()` — click-time offset is
      the settled position _— translateX 0px_
- [x] `spec/motion-waiter.spec.ts`: fast path (static click < 700ms),
      timer-stepped slide settles, perpetual marquee proceeds at the deadline,
      disabled + explicit-timeout passthrough _— 5 tests_
- [x] Export from `src/plugins/index.ts` / `src/index.ts`, README section
      _— README gets a motionWaiter section between spinnerWaiter and
      hydrationWaiter_
- [x] PR body: before/after videos (user-attachments URLs) + todo-app baseline
      video per AGENTS.md _— all three render as inline players on PR #42_

## Implementation notes

- Full suite: 159 passed on the final run (an earlier run had a one-off
  `spec/popup-video.spec.ts` failure under full parallelism that also
  reproduces-then-passes on main — pre-existing flake, not this change).
- The marquee unit test steps every 40ms: cadences slower than
  `sampleInterval` can sit inside a hold across the stillness window
  (documented boundary shared with vanilla Playwright).
