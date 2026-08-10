---
status: ready
size: small
---

# Deflake "uses a normal pointer tail after text cursor holds"

`spec/video-mode-ffmpeg.spec.ts` › "uses a normal pointer tail after text cursor holds" fails intermittently (~1/3 locally, on main and branches alike) at `expect(pointerTailPixelCount(typeTextFrame, typeBox)).toBeLessThan(10)` — the frame sampled at `typeStart + 700` sometimes still shows the pointer tail instead of the text cursor. Timing-sensitive single-frame sampling; consider deriving the sample time from the cursor plan or scanning a frame range like the fill-reveal specs do.

Observed on 2026-08-04 while working on tasks/video-mode-scroll-pan.md (fails identically on main, so unrelated to that branch).
