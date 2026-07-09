import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { test, expect } from "@playwright/test";
import { addPlugins, videoMode } from "../src/index.ts";

const execFile = promisify(execFileCallback);

test.use({ video: "on" });

// A page that stays uniformly blank (white) for `blankMs`, then paints four
// bright quadrants — a hard jump from "nothing on screen" to real content, the
// shape of a real app's about:blank → loading → hydrated startup.
const blankThenContent = (options: { blankMs: number; markerAtMs?: number }) => `
  <style>
    html, body { margin: 0; width: 800px; height: 600px; background: rgb(255, 255, 255); }
    #content { display: none; width: 800px; height: 600px; }
    #content .q { position: absolute; width: 400px; height: 300px; }
    #tl { left: 0; top: 0; background: rgb(220, 30, 30); }
    #tr { left: 400px; top: 0; background: rgb(30, 160, 30); }
    #bl { left: 0; top: 300px; background: rgb(30, 30, 220); }
    #br { left: 400px; top: 300px; background: rgb(230, 200, 20); }
    #marker { position: absolute; left: 2px; top: 2px; width: 6px; height: 6px; background: rgb(0, 0, 0); visibility: hidden; }
  </style>
  <div id="marker"></div>
  <div id="content">
    <div class="q" id="tl"></div><div class="q" id="tr"></div>
    <div class="q" id="bl"></div><div class="q" id="br"></div>
  </div>
  <script>
    ${
      options.markerAtMs === undefined
        ? ""
        : `setTimeout(() => { document.getElementById('marker').style.visibility = 'visible'; }, ${options.markerAtMs});`
    }
    setTimeout(() => { document.getElementById('content').style.display = 'block'; }, ${options.blankMs});
  </script>
`;

test("trims the blank startup lead-in so the video opens on content", async ({ page }, testInfo) => {
  const blankMs = 2000;
  const video = videoMode({ finalHold: 0, highlight: false, autoStart: true });
  {
    await using plugged = await addPlugins({ page, testInfo, plugins: [video] });
    await plugged.setViewportSize({ width: 800, height: 600 });
    await plugged.setContent(blankThenContent({ blankMs }));
    await plugged.locator("#tl").waitFor({ state: "visible", timeout: 10_000 });
    await plugged.waitForTimeout(800);
  }

  const metadata = await video.metadata();
  const paths = video.outputPaths();

  // The start landed on the blank→content transition, not at 0 and not way past it.
  expect(metadata.sourceRange.start).toBeGreaterThan(1200);
  expect(metadata.sourceRange.start).toBeLessThan(blankMs + 1500);

  // The raw recording opens blank-white; the rendered one opens on content.
  const rawOpening = await averagePixel(paths.raw, 60, { x: 200, y: 150 });
  expect(rawOpening.red).toBeGreaterThan(230);
  expect(rawOpening.green).toBeGreaterThan(230);
  expect(rawOpening.blue).toBeGreaterThan(230);
  const renderedOpening = await averagePixel(paths.rendered, 60, { x: 200, y: 150 });
  // top-left quadrant is red
  expect(renderedOpening.red).toBeGreaterThan(150);
  expect(renderedOpening.red).toBeGreaterThan(renderedOpening.green + 60);
  expect(renderedOpening.red).toBeGreaterThan(renderedOpening.blue + 60);
});

test("starts from a selector the moment it becomes visible", async ({ page }, testInfo) => {
  const video = videoMode({
    finalHold: 0,
    highlight: false,
    autoStart: { selector: "#marker" },
  });
  {
    await using plugged = await addPlugins({ page, testInfo, plugins: [video] });
    await plugged.setViewportSize({ width: 800, height: 600 });
    // marker (the "ready" signal) shows well before the busy content paints, so a
    // selector-driven start must land earlier than the pixel detector would.
    await plugged.setContent(blankThenContent({ blankMs: 2800, markerAtMs: 1000 }));
    await plugged.locator("#tl").waitFor({ state: "visible", timeout: 10_000 });
    await plugged.waitForTimeout(500);
  }

  const metadata = await video.metadata();
  expect(metadata.sourceRange.start).toBeGreaterThan(300);
  expect(metadata.sourceRange.start).toBeLessThan(2200);
});

test("leaves a video that was never blank untrimmed", async ({ page }, testInfo) => {
  const video = videoMode({ finalHold: 0, highlight: false, autoStart: true });
  {
    await using plugged = await addPlugins({ page, testInfo, plugins: [video] });
    await plugged.setViewportSize({ width: 800, height: 600 });
    // content is on screen from the first frame — nothing to trim
    await plugged.setContent(blankThenContent({ blankMs: 0 }));
    await plugged.locator("#tl").waitFor({ state: "visible", timeout: 10_000 });
    await plugged.waitForTimeout(800);
  }

  const metadata = await video.metadata();
  expect(metadata.sourceRange.start).toBeUndefined();
});

test("autoStart: false disables trimming even with a long blank lead-in", async ({
  page,
}, testInfo) => {
  const video = videoMode({ finalHold: 0, highlight: false, autoStart: false });
  {
    await using plugged = await addPlugins({ page, testInfo, plugins: [video] });
    await plugged.setViewportSize({ width: 800, height: 600 });
    await plugged.setContent(blankThenContent({ blankMs: 2000 }));
    await plugged.locator("#tl").waitFor({ state: "visible", timeout: 10_000 });
    await plugged.waitForTimeout(500);
  }

  const metadata = await video.metadata();
  expect(metadata.sourceRange.start).toBeUndefined();
});

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
