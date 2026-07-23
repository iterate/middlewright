---
status: complete
size: medium
---

# Add captions to video mode

## Status

Complete. Default and explicit caption capture, nested spans, metadata, timeline-aware ffmpeg rendering, docs, and a paced full-pipeline PR demo are in place. Local validation, CI, and the continuous preview release are green at the pacing implementation commit.

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
- [x] Burn captions into the rendered video and keep them aligned through trimming and dead-air compression. *A realistic three-step account flow verifies each meaningful `test.step` title alongside compressed waits and pointer holds; rendered-piece projection covers timeline transforms.*
- [x] Prove captions are written into `video-rendered.webm` and remain visible with standard video-mode transforms. *The account-flow spec checks rendered output plus visible captions at representative points in the full timeline.*
- [x] Document the option, helper, metadata, and raw/rendered distinction. *README includes both `test.step` and explicit examples plus artifact behavior.*
- [x] Run focused specs, typecheck, build, and the full suite. *Typecheck, build, publint, diff check, and 69 passing tests completed locally; 3 provider-gated tests skipped.*
- [x] Add captioned video or screenshot media to the draft pull request. *PR #6 embeds the caption-only rendered fixture through GitHub's inline video player.*

## Implementation log

- 2026-07-23: Created `feature/video-mode-captions` from `origin/main`. Used `../agents/examples/macwright.ts` as the rendering reference: timed spans become escaped ASS dialogue events that ffmpeg burns into the output.
- 2026-07-23: Playwright exposes user steps through worker-side `TestInfo` internals rather than its public `TestInfo` type. The implementation will isolate that compatibility bridge and restore it after the test.
- 2026-07-23: Confirmed the `_addStep`/`complete` bridge exists in the package's minimum supported Playwright 1.49 as well as the installed 1.60.
- 2026-07-23: Added vertical TDD slices for default `test.step`, explicit-only mode, nested spans, visible ASS rendering, and alignment through trimming/dead-air compression.
- 2026-07-23: The first four-way full run exposed one existing cursor-frame assertion as concurrency-sensitive; it passed alone, and the second full run completed with 69 passing tests and 3 provider-gated skips.
- 2026-07-23: Uploaded the caption-only WebM to PR #6, replaced the task-derived draft body with a reviewer-oriented summary, and verified GitHub rendered an inline `<video>` player.
- 2026-07-23: GitHub CI and continuous preview publishing passed at commit `5d86764`; the PR inbox has no unresolved review threads.
- 2026-07-23: Follow-up found the PR demo's apparent glyph bug was the deliberately contrived `Create {an} account\path` test title, not added renderer output. Replaced it with an account subscription flow whose `test.step` captions are “Enter account details”, “Choose the Pro plan”, and “Confirm the subscription”, then visually checked all three frames.
- 2026-07-23: Replaced PR #6's old attachment and demo copy with the realistic account-flow video. Local validation and CI passed at `10003c1`; GitHub renders only the new inline video.
- 2026-07-23: The caption-only demo rendered in 1.84 seconds, with no highlights and no final hold. Turned the same account flow into a full video-mode showcase: five 900 ms pointer holds, three real loading states compressed from roughly 700 ms to 300 ms, and a 1.2-second success-state hold. The resulting 7.6-second render was checked as a 2 fps contact sheet.
- 2026-07-23: Re-ran typecheck, build, publint, and the full Playwright suite after the pacing follow-up: 69 passed and 3 provider-gated tests skipped.
- 2026-07-23: Replaced the PR demo with the paced 7.6-second WebM and verified GitHub renders exactly one inline video. CI and the continuous preview release passed at `6a36a85`; there were no unresolved review threads.
