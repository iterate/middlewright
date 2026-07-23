---
status: in-progress
size: medium
---

# Add captions to video mode

## Status

Implementation and local validation are complete. Default and explicit caption capture, nested spans, metadata, timeline-aware ffmpeg rendering, and docs are green; only PR media and review follow-up remain.

## Goal

Make rendered `videoMode` artifacts explain the current user-level action with a readable caption. Use Playwright `test.step` titles by default, while letting callers opt out of automatic step capture and mark only chosen spans.

## Public API

```ts
videoMode(); // captions: "test-step"
videoMode({ captions: "explicit" });

await page.videoMode.caption("Create an account", async () => {
  await page.getByText("Create").click();
  await page.getByText("Hooray").click();
});
```

`captions` accepts:

- `"test-step"` (default): turn each `test.step(title, body)` span into a caption.
- `"explicit"`: ignore `test.step`; only `page.videoMode.caption(title, body)` creates captions.

The explicit helper remains available in either mode.

## Assumptions

- Captions are burned into `video-rendered.webm`; `video-raw.webm` stays untouched.
- A test with captions but no highlights, trimming, dead-air compression, or final hold still gets a rendered artifact.
- Caption spans use video mode's existing millisecond timebase and are included in `video-mode.json` for inspection.
- Nested spans show the innermost active caption without overlapping text; the parent caption resumes after the child ends.
- Captions that cross a trim or compressed dead-air boundary stay aligned with the rendered timeline.
- Failed actions still end their caption span and rethrow the original error.
- Titles support punctuation, braces, backslashes, and line breaks without breaking ffmpeg's ASS parser.
- Playwright integration is installed only for the active test and restored during plugin cleanup, preserving any callback or internal method already installed by Playwright.
- `PWDEBUG` keeps video controls inert, but `caption()` still runs and returns the supplied action.

## Checklist

- [x] Add a failing public-behavior spec proving default `test.step` titles become timed caption metadata. *`spec/video-mode.spec.ts` drives a real Playwright step and inspects public metadata.*
- [x] Capture Playwright step start/end boundaries without changing `test.step` behavior. *A scoped `TestInfo._addStep` bridge wraps only `test.step` completion and restores the original method on disposal.*
- [x] Add a failing public-behavior spec for `captions: "explicit"` and `page.videoMode.caption()`. *The explicit-mode spec first failed on the missing helper, then went green through the public page extension.*
- [x] Record explicit spans and suppress automatic Playwright-step captions in explicit mode. *The spec nests an explicit caption inside an ignored Playwright step and verifies the action return value.*
- [x] Define nested-caption behavior with a focused spec. *Innermost spans interrupt the parent; normalized metadata resumes the parent afterward.*
- [x] Burn escaped captions into the rendered video and keep them aligned through trimming and dead-air compression. *ASS generation handles slashes, braces, and line breaks; rendered-piece projection covers timeline transforms.*
- [x] Prove captions alone cause `video-rendered.webm` to be written. *The ffmpeg spec uses no highlight, hold, trim, or compression trigger and compares clean raw pixels with captioned rendered pixels.*
- [x] Document the option, helper, metadata, and raw/rendered distinction. *README includes both `test.step` and explicit examples plus artifact behavior.*
- [x] Run focused specs, typecheck, build, and the full suite. *Typecheck, build, publint, diff check, and 69 passing tests completed locally; 3 provider-gated tests skipped.*
- [ ] Add captioned video or screenshot media to the draft pull request.

## Implementation log

- 2026-07-23: Created `feature/video-mode-captions` from `origin/main`. Used `../agents/examples/macwright.ts` as the rendering reference: timed spans become escaped ASS dialogue events that ffmpeg burns into the output.
- 2026-07-23: Playwright exposes user steps through worker-side `TestInfo` internals rather than its public `TestInfo` type. The implementation will isolate that compatibility bridge and restore it after the test.
- 2026-07-23: Confirmed the `_addStep`/`complete` bridge exists in the package's minimum supported Playwright 1.49 as well as the installed 1.60.
- 2026-07-23: Added vertical TDD slices for default `test.step`, explicit-only mode, nested spans, visible ASS rendering, and alignment through trimming/dead-air compression.
- 2026-07-23: The first four-way full run exposed one existing cursor-frame assertion as concurrency-sensitive; it passed alone, and the second full run completed with 69 passing tests and 3 provider-gated skips.
