import { execFile as execFileCallback } from "node:child_process";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { test, expect } from "@playwright/test";
import { addPlugins, videoMode } from "../src/index.ts";
import { routeAuthDemoApp } from "./auth-demo-app.ts";

test.use({ video: "on" });

test("captures an auto-wrapped popup's raw screencast for the composite", async ({
  page: basePage,
  context,
}, testInfo) => {
  await routeAuthDemoApp(context);
  const video = videoMode({ finalHold: 0, highlight: { mode: "outline", duration: 300 }, trimStart: "never" });
  {
    await using page = await addPlugins({ page: basePage, testInfo, plugins: [video] });
    await page.goto("https://app.middlewright.test/");

    const popupPromise = basePage.waitForEvent("popup");
    await page.getByRole("button", { name: "Sign in" }).click();
    await (await popupPromise).getByRole("button", { name: "Approve" }).click();
    await page.getByText("Signed in as mmkal").waitFor();
  }

  const metadata = await video.metadata();
  expect(metadata.children).toMatchObject([
    {
      // The demo popup closes itself after Approve, like a real OAuth popup —
      // closedAt comes from the close event, and there is no settled
      // recordingEndedAt (the screencast start approximates the timeline).
      closedAt: expect.any(Number),
      highlights: [{ method: "click" }],
      openedAt: expect.any(Number),
      raw: "video-raw-popup-1.webm",
      viewport: { height: expect.any(Number), width: expect.any(Number) },
    },
  ]);
  const [child] = metadata.children;
  expect(child.closedAt!).toBeGreaterThan(child.openedAt);
  expect((await stat(join(testInfo.outputDir, child.raw!))).size).toBeGreaterThan(0);
});

test("renders the popup as a dimmed overlay in one composed video", async ({
  page: basePage,
  context,
}, testInfo) => {
  await routeAuthDemoApp(context);
  const video = videoMode({
    addressBar: false,
    finalHold: 0,
    highlight: { mode: "outline", duration: 500 },
    trimStart: "never",
  });
  {
    await using page = await addPlugins({ page: basePage, testInfo, plugins: [video] });
    await page.goto("https://app.middlewright.test/");

    // No pacing waits: videoMode holds the popup's first action itself until
    // the popup has painted and the enter animation window has real footage.
    const popupPromise = basePage.waitForEvent("popup");
    await page.getByRole("button", { name: "Sign in" }).click();
    const popup = await popupPromise;
    await popup.getByRole("button", { name: "Approve" }).click();
    await page.getByText("Signed in as mmkal").waitFor();
  }

  await expect(video.metadata()).resolves.toMatchObject({
    outputs: { rendered: "video-rendered.webm" },
  });
  const frames = await videoFrameSamples(video.outputPaths().rendered);
  // The demo app's background is a light gray (~245) throughout, so a
  // darkened corner marks a frame where the popup backdrop dim is active.
  // The downscale blends the thin dim border with its bright neighbors, so
  // dimmed corners read ~211 (overlay up) down to ~147 (exit fade), against
  // ~245 when lit.
  const dimmedFrames = frames.filter((frame) => frame.corner < 235);
  const litFrames = frames.filter((frame) => frame.corner >= 235);
  expect(dimmedFrames.length).toBeGreaterThan(0);
  expect(litFrames.length).toBeGreaterThan(0);
  // While dimmed, the popup's white card sits centered above the backdrop.
  const overlayFrames = dimmedFrames.filter((frame) => frame.centerPeak > 220);
  expect(overlayFrames.length).toBeGreaterThan(0);
});

test("records separate videos for the main page and an auth popup", async ({
  page: basePage,
  context,
}, testInfo) => {
  await routeAuthDemoApp(context);
  const video = videoMode({ finalHold: 0, highlight: { mode: "outline", duration: 300 }, trimStart: "never" });
  let popupVideo!: ReturnType<typeof videoMode>;
  {
    await using page = await addPlugins({ page: basePage, testInfo, plugins: [video], popups: false });
    await page.goto("https://app.middlewright.test/");

    const popupPromise = basePage.waitForEvent("popup");
    await page.getByRole("button", { name: "Sign in" }).click();
    popupVideo = videoMode({ finalHold: 0, highlight: { mode: "outline", duration: 300 }, trimStart: "never" });
    await using popup = await addPlugins({
      page: await popupPromise,
      testInfo,
      plugins: [popupVideo],
    });

    await popup.getByRole("button", { name: "Approve" }).click();
    await page.getByText("Signed in as mmkal").waitFor();
  }

  // Playwright screencasts each page separately, so each instance ends the
  // test with its own raw recording and its own annotated render.
  await expect(video.metadata()).resolves.toMatchObject({
    outputs: { raw: "video-raw.webm", rendered: "video-rendered.webm" },
  });
  await expect(popupVideo.metadata()).resolves.toMatchObject({
    outputs: { raw: "video-raw-2.webm", rendered: "video-rendered-2.webm" },
  });
  for (const path of [
    video.outputPaths().raw,
    video.outputPaths().rendered,
    popupVideo.outputPaths().raw,
    popupVideo.outputPaths().rendered,
  ]) {
    expect((await stat(path)).size).toBeGreaterThan(0);
  }
});

const execFile = promisify(execFileCallback);

/**
 * Decode the video to small grayscale frames and sample each one: a pixel
 * near the bottom-left corner (page background), and the brightest pixel of
 * the central quarter (the popup card when the overlay is up). 0-255.
 */
const videoFrameSamples = async (path: string) => {
  const size = 64;
  const { stdout } = await execFile(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      path,
      "-vf",
      `fps=10,scale=${size}:${size},format=gray`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "gray",
      "pipe:1",
    ],
    { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
  );
  const frameSize = size * size;
  const frames: { centerPeak: number; corner: number }[] = [];

  for (let offset = 0; offset + frameSize <= stdout.length; offset += frameSize) {
    let centerPeak = 0;
    for (let y = Math.floor(size * 0.375); y < Math.floor(size * 0.625); y += 1) {
      for (let x = Math.floor(size * 0.375); x < Math.floor(size * 0.625); x += 1) {
        centerPeak = Math.max(centerPeak, stdout[offset + y * size + x]);
      }
    }
    frames.push({
      centerPeak,
      corner: stdout[offset + (size - 4) * size + 3],
    });
  }

  return frames;
};
