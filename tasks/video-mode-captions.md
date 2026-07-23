---
status: in-progress
size: medium
---

# Add captions to video mode

## Status

Specified and ready for the first failing spec. The worktree and public API are decided; Playwright step capture, caption metadata, ffmpeg rendering, docs, and PR media remain.

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

- [ ] Add a failing public-behavior spec proving default `test.step` titles become timed caption metadata.
- [ ] Capture Playwright step start/end boundaries without changing `test.step` behavior.
- [ ] Add a failing public-behavior spec for `captions: "explicit"` and `page.videoMode.caption()`.
- [ ] Record explicit spans and suppress automatic Playwright-step captions in explicit mode.
- [ ] Define nested-caption behavior with a focused spec.
- [ ] Burn escaped captions into the rendered video and keep them aligned through trimming and dead-air compression.
- [ ] Prove captions alone cause `video-rendered.webm` to be written.
- [ ] Document the option, helper, metadata, and raw/rendered distinction.
- [ ] Run focused specs, typecheck, build, and the full suite.
- [ ] Add captioned video or screenshot media to the draft pull request.

## Implementation log

- 2026-07-23: Created `feature/video-mode-captions` from `origin/main`. Used `../agents/examples/macwright.ts` as the rendering reference: timed spans become escaped ASS dialogue events that ffmpeg burns into the output.
- 2026-07-23: Playwright exposes user steps through worker-side `TestInfo` internals rather than its public `TestInfo` type. The implementation will isolate that compatibility bridge and restore it after the test.
