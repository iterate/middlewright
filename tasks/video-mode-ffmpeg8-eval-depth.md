---
status: in-progress
size: small
---

# video-mode: flatten cursorExpression so ffmpeg 8's eval depth limit can't kill long renders

## Status summary

Task fleshed out, implementation not started. Diagnosis is complete and verified
(see notes below): ffmpeg 8 caps expression nesting at ~100 and `cursorExpression`
nests one `if()` per cursor waypoint segment, so any spec with roughly 35+
pointer-highlighted actions fails at render time.

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

- [ ] Flatten `cursorExpression` to the constant-depth sum form
- [ ] Regression test: generated expression keeps constant nesting depth and
      identical values (boundaries included) for a waypoint count well past the
      ffmpeg 8 cap, and ffmpeg itself accepts it
- [ ] Integration repro: a pointer-mode spec with enough actions to exceed the
      old nesting cap renders successfully (fails on ffmpeg 8 before the fix;
      on CI's older ffmpeg it's correctness coverage only — the depth assertion
      is the cross-version guard)
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
