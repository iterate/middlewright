# Popup overlay videos + auto-wrapped popup plugins

---
status: in-progress
size: large
branch: popup-overlay
base: popup-plugins (PR #32)
---

**Status summary**: design settled via grill session (decisions below). Implementation in 4 phases; starting phase 1.

## Checklist

- [ ] Phase 1: plugin-system guard + auto-wrap (`popups: false` opt-out, `forPopup` hook, double-wrap error, spec migration)
- [ ] Phase 2: videoMode child recorder — facts + metadata `children` schema
- [ ] Phase 3: render integration — composited timeline, overlay transform, cursor projection
- [ ] Phase 4: docs + permanent demo spec + refreshed PR video

## Context

PR #32 (branch `popup-plugins`) made popups wrappable: per-instance videoMode artifact namespacing, so a popup's own instance renders a separate `-2` video. This design goes further: popups get wrapped *automatically*, and video mode renders the popup's screencast as a scaled overlay on the main page's video — one composed output, since rendering happens in post anyway.

## Decisions

1. **Per-instance artifact namespacing** — shipped in PR #32. Multiple `videoMode()` instances per test auto-index their artifacts; first instance keeps legacy names.
2. **Reuse guard** — shipped in PR #32. Wiring one active `videoMode()` instance to a second page throws; one instance per page.
3. **Separate videos per page is the current model** — shipped in PR #32; overlay composition builds on top (Playwright screencasts each page separately regardless).
4. **Parent-owned composition** — popup recording is a child sub-timeline of the main page's `videoMode`; only the parent renders, producing one video with the popup overlaid. Manual standalone instances (`popups: false` + fresh instance) keep separate `-2` videos.
5. **Auto-wrap is default-ON at plugin-system level** — wrapped pages listen for `"popup"` and auto-wrap it; plugins may declare `forPopup(ctx)` to produce their child (videoMode returns a parent-bound child recorder), stateless plugins re-register as-is. Opt out with `popups: false`. Parent dispose disposes children.
6. **Unified piece timeline** — child highlights/holds are first-class pieces in the parent's render plan. Complexity tamed: (i) ONE output stream — holds/freezes freeze the composite, so the triggering source never matters; (ii) pieces/highlights carry a source tag (parent | child N), child coordinates project through the overlay transform, planner stays single-timeline; (iii) the "parent quiet while popup visible" assumption is not load-bearing — simultaneous actions degrade gracefully. One cursor, planned globally, glides between page and overlay.
7. **Overlay presentation** — appears at popup creation, disappears at close (or render end); ~200ms scale+fade enter/exit (filter-level, no synthetic time; hard cut fallback); centered, fit to **90%** of the parent frame preserving popup aspect; parent footage live underneath, dimmed ~40%; multiple/nested popups stack newest-on-top.
8. **Double-wrap throws; no `.original()`** — `addPlugins` on an already-wrapped page errors (also guards accidental double-wrap of main pages). `popups: false` is the manual-control path. PR #32's manual-wrap specs become the `popups: false` coverage.
9. **Permanent demo spec** — commit the popup demo as `spec/popup-overlay-demo.spec.ts` with light assertions (rendered output exists; metadata contains a child with open/close span). Precedent: `scroll-pan-demo.spec.ts`.

## Settled by recommendation

- **Clock alignment**: every instance anchors to process-wide `performance.now()`; each source's raw video is calibrated to that clock at its close (existing `settleVideoRecorder` + close-midpoint technique, applied per source). Child→parent time mapping is arithmetic.
- **Dead-air**: unified — a span is dead air only if *no* source has activity; child recorders have no standalone compression (one timeline by construction).
- **Captions**: parent renders unified `test.step` captions full-frame; child recorders don't observe steps separately.
- **Edge cases**: popup closed mid-action → child sub-timeline ends (overlay exits); popup open at test end → child settled+closed during parent finalize, before the parent's own close; screencasts for late-created pages come free from context-level `video: "on"`.
- **Metadata**: `video-mode.json` gains `children: [{ openedAt, closedAt, viewport, highlights, deadAir, ... }]` mirroring the top-level shape, plus a `source` tag on rendered pieces. Schema version bump.

## Implementation plan (phases, each a PR-able chunk on top of `popup-plugins`)

1. **Plugin-system: guard + auto-wrap.** Throw on double-wrap. `popups: false` option. On `"popup"`: build child plugin list (`forPopup(ctx)` hook, else reuse), wrap the popup, register child disposal under the parent's dispose. Specs: auto-wrap applies middleware to popups; opt-out; double-wrap error; PR #32 specs migrate to `popups: false`.
2. **videoMode child recorder (facts only).** `forPopup` returns a parent-bound child: records highlights/open/close/viewport into the parent's state under a child entry; per-source clock calibration at close; metadata `children` schema. No rendering changes yet — specs assert metadata.
3. **Render integration.** Source-tagged pieces; overlay transform (90% fit, ~40% dim, enter/exit); child highlight/pointer coordinate projection; cross-source cursor planning; unified dead-air segments. ffmpeg-level specs sampling frames for the overlay + backdrop dim (same technique as `video-mode-ffmpeg.spec.ts`).
4. **Docs + demo.** Commit the permanent demo spec, README popup section update, refresh the PR demo video showing ONE composed video.

Key files: `src/plugin-system.ts` (guard, auto-wrap, `forPopup`), `src/plugins/video-mode.ts` (child recorder, calibration, metadata, render), `spec/popup*.spec.ts`, `spec/auth-demo-app.ts`, README.

Verification: full suite green at each phase; phase 3 verified by frame-sampling specs plus eyeballing the rendered demo video.
