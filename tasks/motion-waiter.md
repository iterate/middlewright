---
status: in-progress
size: medium
---

# motion-waiter: don't click elements that are still sliding

## Status summary

Spec fleshed out, implementation not started. Main pieces: the repro demo spec
(before video), the `motionWaiter` plugin, the after video, exports + docs.

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
- **Budgeted, never blocking**: default 1s `settleTimeout`; perpetual motion
  (marquees, spinners that rotate the box) proceeds at the deadline with a log
  line rather than failing.
- **Cheap when nothing moves**: one extra sample interval (~60ms) per action.
  Only once motion is observed does the plugin require a longer quiet window
  (~150ms of unchanged box) before proceeding — that defeats step cadences
  slower than the sample interval.
- **Escape hatches match spinner-waiter**: `settings.run({ disabled: true })`
  per block, an author-passed explicit `{ timeout }` passes straight through,
  `PWDEBUG` disables the plugin.

## Checklist

- [ ] Repro demo: a slow (≈1.2s) timer-driven sliding drawer app +
      `spec/motion-drawer-demo.spec.ts` where the un-helped click provably
      lands mid-slide (the app records the drawer's offset at click time), for
      the "before" video
- [ ] `src/plugins/motion-waiter.ts`: the plugin per the decisions above
- [ ] "after" demo test: same app with `motionWaiter()` — click-time offset is
      the settled position
- [ ] `spec/motion-waiter.spec.ts`: fast path (static element ≈ one interval),
      timer-stepped slide settles, perpetual marquee proceeds at deadline,
      `disabled` + explicit-timeout passthrough
- [ ] Export from `src/plugins/index.ts` / `src/index.ts`, README section
- [ ] PR body: before/after videos (user-attachments URLs) + todo-app baseline
      video per AGENTS.md
