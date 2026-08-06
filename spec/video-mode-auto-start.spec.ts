import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { test, expect } from "@playwright/test";
import { addPlugins, videoMode } from "../src/index.ts";

const execFile = promisify(execFileCallback);

test.use({ video: "on" });

// A page that stays blank for `blankMs`, then paints its content — the shape of
// a real app's about:blank → loading → hydrated startup.
const blankThenContent = (options: { blankMs: number; markerAtMs?: number }) => `
  <style>
    @keyframes recorder-heartbeat {
      from { transform: translateX(0); }
      to { transform: translateX(790px); }
    }
    #recorder-heartbeat {
      animation: recorder-heartbeat 100ms linear infinite alternate;
      background: rgb(254, 254, 254);
      height: 2px;
      position: fixed;
      width: 2px;
    }
  </style>
  <div id="recorder-heartbeat"></div>
  <div id="marker" hidden>ready</div>
  <div id="tl" hidden style="width: 800px; height: 600px; background: rgb(220, 30, 30)"></div>
  <script>
    ${
      options.markerAtMs === undefined
        ? ""
        : `setTimeout(() => { document.getElementById('marker').hidden = false; }, ${options.markerAtMs});`
    }
    setTimeout(() => { document.getElementById('tl').hidden = false; }, ${options.blankMs});
  </script>
`;

test("starts at the first locator invocation by default", async ({ page: basePage }, testInfo) => {
  const video = videoMode({ finalHold: 0, highlight: false });
  {
    await using page = await addPlugins({ page: basePage, testInfo, plugins: [video] });
    await page.setContent(`
      <button id="ready" hidden>Ready</button>
      <button id="next">Next</button>
      <script>setTimeout(() => { document.querySelector('#ready').hidden = false; }, 600)</script>
    `);

    const firstLocatorBefore = page.videoMode.getVideoTimestamp();
    await page.locator("#ready").waitFor();
    const firstLocatorAfter = page.videoMode.getVideoTimestamp();
    const firstStart = (await video.metadata()).sourceRange.start;

    expect(firstLocatorAfter - firstLocatorBefore).toBeGreaterThan(400);
    expect(firstStart).toBeGreaterThanOrEqual(firstLocatorBefore);
    expect(firstStart).toBeLessThan(firstLocatorBefore + 100);

    await page.waitForTimeout(100);
    await page.locator("#next").click();
    expect((await video.metadata()).sourceRange).toMatchObject({ start: firstStart });
  }
});

test("detects the blank startup lead-in when requested", async ({ page: basePage }, testInfo) => {
  const blankMs = 2000;
  const video = videoMode({ finalHold: 0, highlight: false, trimStart: "detect-blank" });
  {
    await using page = await addPlugins({ page: basePage, testInfo, plugins: [video] });
    await page.setViewportSize({ width: 800, height: 600 });
    await page.setContent(blankThenContent({ blankMs }));
    // timeout bounds this synthetic transition; spinner waiter is absent to isolate video mode.
    await page.locator("#tl").waitFor({ state: "visible", timeout: 10_000 });
    await page.waitForTimeout(800);
  }

  const metadata = await video.metadata();
  const paths = video.outputPaths();

  // The detected start is in raw-recorder time, whose origin is the first
  // screencast frame rather than setContent(). It landed after a real blank
  // lead-in and not way past the content transition.
  expect(metadata.sourceRange.start).toBeGreaterThan(0);
  expect(metadata.sourceRange.start).toBeLessThan(blankMs + 1500);

  // The raw recording opens blank-white; the rendered one opens on content.
  const rawOpening = await averagePixel(paths.raw, 60, { x: 200, y: 150 });
  expect(rawOpening.red).toBeGreaterThan(230);
  expect(rawOpening.green).toBeGreaterThan(230);
  expect(rawOpening.blue).toBeGreaterThan(230);
  const renderedOpening = await averagePixel(paths.rendered, 60, { x: 200, y: 150 });
  // content is red
  expect(renderedOpening.red).toBeGreaterThan(150);
  expect(renderedOpening.red).toBeGreaterThan(renderedOpening.green + 60);
  expect(renderedOpening.red).toBeGreaterThan(renderedOpening.blue + 60);
});

test("starts from a selector the moment it becomes visible", async ({ page: basePage }, testInfo) => {
  const video = videoMode({
    finalHold: 0,
    highlight: false,
    trimStart: ["selector", "#marker"],
  });
  {
    await using page = await addPlugins({ page: basePage, testInfo, plugins: [video] });
    await page.setViewportSize({ width: 800, height: 600 });
    // marker (the "ready" signal) shows well before the busy content paints, so a
    // selector-driven start must land earlier than the pixel detector would.
    await page.setContent(blankThenContent({ blankMs: 2800, markerAtMs: 1000 }));
    // timeout bounds this synthetic transition; spinner waiter is absent to isolate video mode.
    await page.locator("#tl").waitFor({ state: "visible", timeout: 10_000 });
    await page.waitForTimeout(500);
  }

  const metadata = await video.metadata();
  expect(metadata.sourceRange.start).toBeGreaterThan(300);
  expect(metadata.sourceRange.start).toBeLessThan(2200);

  // The selector-driven start must reach renderVideo, not just the metadata:
  // the rendered clip is meaningfully shorter than the raw recording.
  const paths = video.outputPaths();
  const rawDuration = await videoDurationMs(paths.raw);
  const renderedDuration = await videoDurationMs(paths.rendered);
  expect(renderedDuration).toBeLessThan(rawDuration - 500);
});

test('trimStart: "detect-blank" leaves a video that was never blank untrimmed', async ({
  page: basePage,
}, testInfo) => {
  const video = videoMode({ finalHold: 0, highlight: false, trimStart: "detect-blank" });
  {
    await using page = await addPlugins({ page: basePage, testInfo, plugins: [video] });
    await page.setViewportSize({ width: 800, height: 600 });
    // content is on screen from the first frame — nothing to trim
    await page.setContent(blankThenContent({ blankMs: 0 }));
    // timeout bounds this synthetic transition; spinner waiter is absent to isolate video mode.
    await page.locator("#tl").waitFor({ state: "visible", timeout: 10_000 });
    await page.waitForTimeout(800);
  }

  const metadata = await video.metadata();
  expect(metadata.sourceRange.start).toBeUndefined();
});

test('trimStart: "never" disables trimming even with a long blank lead-in', async ({
  page: basePage,
}, testInfo) => {
  const video = videoMode({ finalHold: 0, highlight: false, trimStart: "never" });
  {
    await using page = await addPlugins({ page: basePage, testInfo, plugins: [video] });
    await page.setViewportSize({ width: 800, height: 600 });
    await page.setContent(blankThenContent({ blankMs: 2000 }));
    // timeout bounds this synthetic transition; spinner waiter is absent to isolate video mode.
    await page.locator("#tl").waitFor({ state: "visible", timeout: 10_000 });
    await page.waitForTimeout(500);
  }

  const metadata = await video.metadata();
  expect(metadata.sourceRange.start).toBeUndefined();
});

const videoDurationMs = async (path: string) => {
  const { stdout } = await execFile("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=nokey=1:noprint_wrappers=1", path,
  ]);
  return Math.round(Number(stdout.trim()) * 1000);
};

const videoInfo = async (path: string) => {
  const { stdout } = await execFile("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height", "-of", "json", path,
  ]);
  const [stream] = JSON.parse(stdout).streams;
  return { height: Number(stream.height), width: Number(stream.width) };
};

const averagePixel = async (path: string, timestampMs: number, point: { x: number; y: number }) => {
  const info = await videoInfo(path);
  const { stdout } = await execFile(
    "ffmpeg",
    [
      "-hide_banner", "-loglevel", "error",
      "-ss", String(Math.max(0, timestampMs) / 1000),
      "-i", path,
      "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
    ],
    { encoding: "buffer", maxBuffer: info.width * info.height * 3 + 1024 },
  );
  const data = stdout as Buffer;
  const radius = 4;
  let red = 0, green = 0, blue = 0, count = 0;
  for (let y = point.y - radius; y <= point.y + radius; y += 1) {
    for (let x = point.x - radius; x <= point.x + radius; x += 1) {
      if (x < 0 || y < 0 || x >= info.width || y >= info.height) continue;
      const offset = (y * info.width + x) * 3;
      red += data[offset];
      green += data[offset + 1];
      blue += data[offset + 2];
      count += 1;
    }
  }
  return { red: Math.round(red / count), green: Math.round(green / count), blue: Math.round(blue / count) };
};
