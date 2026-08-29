---
status: in-progress
size: medium
---

# motion-waiter: don't click elements that are still sliding

## Status summary

Plugin, demo spec (before/after), unit spec, exports and README all done and
passing. Remaining: attach before/after videos + the todo-app baseline video
to the PR body.

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
- **Cheap when nothing moves**: one extra sample interval (~60ms) per action.
  Only once motion is observed does the plugin require a longer quiet window
  (150ms of unchanged box) before proceeding — that defeats step cadences
  slower than the sample interval. Cadences slower than `sampleInterval` can
  pass the initial check (documented boundary, same as vanilla Playwright).
- **Escape hatches match spinner-waiter**: `settings.run({ disabled: true })`
  per block, an author-passed explicit `{ timeout }` passes straight through
  (which also makes `[spinnerWaiter(), motionWaiter()]` compose: the
  fast-fail's injected 1ms timeout skips the inner motion wait), `PWDEBUG`
  disables the plugin.

## Checklist

- [x] Repro demo: a slow (1s) timer-driven sliding drawer app +
      `spec/motion-drawer-demo.spec.ts` where the un-helped click provably
      lands mid-slide, for the "before" video _— control click lands at
      translateX −240.8px of a 280px drawer (≈14% open); the app records the
      offset at click time_
- [x] `src/plugins/motion-waiter.ts`: the plugin per the decisions above
- [x] "after" demo test: same app with `motionWaiter()` — click-time offset is
      the settled position _— translateX 0px_
- [x] `spec/motion-waiter.spec.ts`: fast path (static click < 700ms),
      timer-stepped slide settles, perpetual marquee proceeds at the deadline,
      disabled + explicit-timeout passthrough _— 5 tests_
- [x] Export from `src/plugins/index.ts` / `src/index.ts`, README section
      _— README gets a motionWaiter section between spinnerWaiter and
      hydrationWaiter_
- [ ] PR body: before/after videos (user-attachments URLs) + todo-app baseline
      video per AGENTS.md

## Implementation notes

- Full suite: 158 passed; `spec/popup-video.spec.ts` failed once under full
  parallelism but passes in isolation on this branch AND on main (main's tip
  commit is itself a video-flake fix) — pre-existing flake, not this change.
- The marquee unit test steps every 40ms: a 120ms-step marquee sits inside the
  documented fast-path boundary (holds longer than `sampleInterval` look
  static on the first confirming sample).
