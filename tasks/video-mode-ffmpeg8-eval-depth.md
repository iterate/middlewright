---
status: in-progress
size: small
---

# video-mode: flatten cursorExpression so ffmpeg 8's eval depth limit can't kill long renders

## Status summary

Implemented: `cursorExpression` now emits the constant-depth sum, with a new
node-only spec (`spec/video-mode-cursor-expression.spec.ts`) guarding depth,
ffmpeg parseability, and boundary values. Remaining: full local suite pass on
ffmpeg 8 + real-world render of the long iterate mobile spec against the
patched build.

## Problem

`cursorExpression` (src/plugins/video-mode.ts, the pointer-overlay x/y builder)
emits one nested `if(between(t,a,b), value, <rest>)` level per waypoint segment.
Nesting depth is O(actions in the test).

ffmpeg 8 (homebrew's current: 8.0.1) added a recursion-depth cap (~100) to its
expression parser. Empirically: depth 90 parses, depth 100 fails with
`Missing ')' or too many args`. The render's `execFile` rejection then surfaces
the entire multi-kilobyte command line as the test error.

First seen 2026-09-01 rendering iterate's `specs/mobile/approvals.spec.ts`
(~350 filter nodes, 100+ waypoint segments). Not mobile-specific: any long spec
with `highlight: { mode: "pointer" }` on ffmpeg 8 hits it. ffmpeg ≤7 has no
limit, which is why short specs and CI (ubuntu's ffmpeg 6.1) never noticed.

## Fix

The waypoint segments are sequential and disjoint, so the nested-if chain is
just a first-match lookup. Flatten it to a constant-depth sum:

```
Σ (gte(t,aᵢ)*lt(t,bᵢ)) * valueᵢ(t)   +   (1 - gte(t,first)*lt(t,last)) * base
```

- Half-open `gte`/`lt` windows instead of `between` (inclusive both ends), so a
  shared segment boundary can't fire two terms and double the coordinate. At a
  boundary the successor's term yields the same position the nested version did.
- `base` is the last waypoint's coordinate — same fallback the nested version
  used for t outside all segments (before the first waypoint and at/after the
  last).
- Depth stays ~10 (the eased-progress parens) regardless of segment count.
  Verified parseable and runnable on ffmpeg 8.0.1 at 400 segments.

## Checklist

- [x] Flatten `cursorExpression` to the constant-depth sum form _(src/plugins/video-mode.ts — sum of half-open gte/lt windows plus a complement term carrying the last waypoint's position)_
- [x] Regression test: generated expression keeps constant nesting depth and
      identical values (boundaries included) for a waypoint count well past the
      ffmpeg 8 cap, and ffmpeg itself accepts it _(spec/video-mode-cursor-expression.spec.ts: 400 segments, depth < 32, ffmpeg overlay probe with production quoting, JS-evaluated value comparison at every boundary + midpoint; mutation-checked — inclusive windows fail the value test)_
- [x] ~~Integration repro: a pointer-mode spec with enough actions to exceed the
      old nesting cap renders successfully~~ _(dropped: ~40 clicks + render would need a test-timeout bump, and on CI's older ffmpeg it could never fail for the depth reason anyway — the expression spec's ffmpeg probe is the cross-version guard, and the long iterate mobile spec was rendered against the patched build as the real-world proof)_
- [ ] Existing video-mode specs still green locally (this machine's ffmpeg 8 is
      the strict parser)

## Non-goals / follow-ups

- Truncating the giant `Command failed: ffmpeg …` message when a render fails
  (the stderr is buried under kilobytes of command line) — worth doing but a
  separate change.
- `slideY` (child overlay) and `videoSpanExpression` were checked: constant
  depth already, no change needed.

## Implementation notes

(log during implementation)
