import { execFile as execFileCallback } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { test, expect } from "@playwright/test";
import { addPlugins, spinnerWaiter, videoMode } from "../src/index.ts";

const execFile = promisify(execFileCallback);

test.use({ video: "on" });

test("writes a rendered video with dead air removed and highlights added in post", async ({
  page,
}, testInfo) => {
  const deadAirThresholdMs = 300;
  const finalHoldMs = 700;
  const highlightDurationMs = 1000;
  const video = videoMode({
    deadAirThreshold: deadAirThresholdMs,
    finalHold: finalHoldMs,
    highlightDuration: highlightDurationMs,
  });
  {
    await using plugged = await addPlugins({
      page,
      testInfo,
      plugins: [
        spinnerWaiter({
          log: (message) => console.log(`[spinnerWaiter] ${message}`),
          spinnerTimeout: 12_000,
        }),
        video,
      ],
    });
    await plugged.setViewportSize({ width: 800, height: 600 });
    await plugged.setContent(`
      <main style="display: flex; flex-direction: column; gap: 16px">
        <div data-spinner="true" style="visibility: hidden;">Loading...</div>
        <div class="stages" style="display: flex; gap: 16px;">
          <button data-stage-index="0">Start import</button>
          <button data-stage-index="1">Review records</button>
          <button data-stage-index="2">Approve import</button>
          <button data-stage-index="3">Download receipt</button>
        </div>
        <div id="result"></div>
      </main>
      <script>
        const spinner = document.querySelector('[data-spinner]');
        const buttons = Array.from(document.querySelectorAll('button[data-stage-index]'));
        const result = document.querySelector('#result');
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const stages = [
          { delay: 2200 },
          { delay: 2600 },
          { delay: 1600 },
          { delay: 1800, done: true },
        ];

        function setActiveStage(index) {
          spinner.style.visibility = 'hidden';
          buttons.forEach((button, buttonIndex) => {
            button.disabled = buttonIndex !== index;
          });
        }

        buttons.forEach((button) => {
          button.addEventListener('click', async () => {
            buttons.forEach((button) => {
              button.disabled = true;
            });
            spinner.style.visibility = 'visible';

            const index = Number(button.dataset.stageIndex);
            const stage = stages[index];
            await sleep(stage.delay);

            if (stage.done) {
              spinner.style.visibility = 'hidden';
              result.textContent = 'Receipt ready';
              return;
            }

            setActiveStage(index + 1);
          });
        });

        setActiveStage(0);
      </script>
    `);

    await plugged.getByText("Start import").click();
    await plugged.getByText("Review records").click();
    await plugged.getByText("Approve import").click();
    await plugged.videoMode.deadAir(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1700));
    });
    await plugged.getByText("Download receipt").click();

    await plugged.getByText("Receipt ready").waitFor();
    await expect(plugged.getByText("Receipt ready")).toContainText("Receipt ready");
  }

  const metadata = JSON.parse(
    await readFile(join(testInfo.outputDir, "video-mode.json"), "utf8"),
  );
  expect(metadata).toMatchObject({
    outputs: {
      rendered: "video-rendered.webm",
      raw: "video-raw.webm",
    },
  });
  expect(
    metadata.deadAir.filter((span: { end: number; start: number }) => span.end - span.start >= 1500)
      .length,
  ).toBeGreaterThanOrEqual(4);
  expect(metadata.highlights.length).toBeGreaterThanOrEqual(4);

  const rawPath = join(testInfo.outputDir, metadata.outputs.raw);
  const renderedPath = join(testInfo.outputDir, metadata.outputs.rendered);
  const rawStats = await stat(rawPath);
  const renderedStats = await stat(renderedPath);
  console.log(`raw video written to ${rawPath}`);
  console.log(`rendered video written to ${renderedPath}`);

  expect(rawStats.size).toBeGreaterThan(0);
  expect(renderedStats.size).toBeGreaterThan(0);

  const rawDuration = await videoDurationMs(rawPath);
  const renderedDuration = await videoDurationMs(renderedPath);
  const expectedRenderedDuration =
    rawDuration -
    metadata.deadAir.reduce((removedDuration: number, span: { end: number; start: number }) => {
      return removedDuration + Math.max(0, span.end - span.start - deadAirThresholdMs);
    }, 0) +
    metadata.highlights.reduce(
      (duration: number, highlight: { end: number; start: number }) =>
        duration + highlight.end - highlight.start,
      0,
    ) +
    finalHoldMs;

  expect(renderedDuration).toBeLessThan(rawDuration + metadata.highlights.length * highlightDurationMs);
  expect(Math.abs(renderedDuration - expectedRenderedDuration)).toBeLessThan(1500);
});

test("renders calibrated highlight boxes on a paused pre-click frame", async ({
  page,
}, testInfo) => {
  const highlightDurationMs = 900;
  const video = videoMode({
    finalHold: 0,
    highlightColor: "yellow",
    highlightDuration: highlightDurationMs,
    highlightThickness: 8,
  });
  {
    await using plugged = await addPlugins({
      page,
      testInfo,
      plugins: [video],
    });
    await plugged.setViewportSize({ width: 800, height: 600 });
    await plugged.setContent(`
      <style>
        html, body {
          margin: 0;
          width: 800px;
          height: 600px;
          background: rgb(255, 255, 255);
        }
        #target {
          position: absolute;
          left: 120px;
          top: 80px;
          width: 160px;
          height: 90px;
          background: rgb(0, 80, 255);
        }
      </style>
      <div id="target" onclick="this.style.background = 'rgb(255, 0, 0)'"></div>
    `);

    await plugged.locator("#target").click();
    await expect(plugged.locator("#target")).toHaveCSS("background-color", "rgb(255, 0, 0)");
    await page.waitForTimeout(300);
  }

  const metadata = JSON.parse(
    await readFile(join(testInfo.outputDir, "video-mode.json"), "utf8"),
  );
  const [highlight] = metadata.highlights;
  expect(highlight).toMatchObject({
    color: "yellow",
    rect: {
      height: 90,
      width: 160,
      x: 120,
      y: 80,
    },
    thickness: 8,
    viewport: {
      height: 600,
      width: 800,
    },
  });

  const renderedPath = join(testInfo.outputDir, metadata.outputs.rendered);
  const pauseFrame = await videoFrame(
    renderedPath,
    highlight.start + Math.round(highlightDurationMs / 2),
  );
  const afterClickFrame = await videoFrame(
    renderedPath,
    highlight.start + highlightDurationMs + 250,
  );
  const expectedScale = Math.min(
    pauseFrame.width / highlight.viewport.width,
    pauseFrame.height / highlight.viewport.height,
  );
  const expectedBox = {
    height: Math.round(highlight.rect.height * expectedScale),
    width: Math.round(highlight.rect.width * expectedScale),
    x: Math.round(highlight.rect.x * expectedScale),
    y: Math.round(highlight.rect.y * expectedScale),
  };
  const yellowBox = yellowBoundingBox(pauseFrame);

  expect(yellowBox).toMatchObject({
    height: expect.closeTo(expectedBox.height, 4),
    width: expect.closeTo(expectedBox.width, 4),
    x: expect.closeTo(expectedBox.x, 3),
    y: expect.closeTo(expectedBox.y, 3),
  });

  const pauseCenter = averagePixel(pauseFrame, centerOf(expectedBox));
  const afterClickCenter = averagePixel(afterClickFrame, centerOf(expectedBox));

  expect(pauseCenter).toMatchObject({
    blue: expect.any(Number),
    green: expect.any(Number),
    red: expect.any(Number),
  });
  expect(pauseCenter.blue).toBeGreaterThan(pauseCenter.red + 80);
  expect(afterClickCenter.red).toBeGreaterThan(afterClickCenter.blue + 80);
});

const videoDurationMs = async (path: string) => {
  const { stdout } = await execFile(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nokey=1:noprint_wrappers=1", path],
    { maxBuffer: 1024 * 1024 },
  );

  return Math.round(Number(stdout.trim()) * 1000);
};

const videoInfo = async (path: string) => {
  const { stdout } = await execFile(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      path,
    ],
    { maxBuffer: 1024 * 1024 },
  );
  const payload = JSON.parse(stdout);
  const [stream] = payload.streams;

  return {
    height: Number(stream.height),
    width: Number(stream.width),
  };
};

const videoFrame = async (path: string, timestampMs: number) => {
  const info = await videoInfo(path);
  const { stdout } = await execFile(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(Math.max(0, timestampMs) / 1000),
      "-i",
      path,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ],
    {
      encoding: "buffer",
      maxBuffer: info.width * info.height * 3 + 1024,
    },
  );

  return {
    data: stdout as Buffer,
    height: info.height,
    width: info.width,
  };
};

const yellowBoundingBox = (frame: Awaited<ReturnType<typeof videoFrame>>) => {
  let minX = frame.width;
  let minY = frame.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const offset = (y * frame.width + x) * 3;
      const red = frame.data[offset];
      const green = frame.data[offset + 1];
      const blue = frame.data[offset + 2];

      if (red > 180 && green > 160 && blue < 100) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  expect(maxX).toBeGreaterThanOrEqual(0);

  return {
    height: maxY - minY + 1,
    width: maxX - minX + 1,
    x: minX,
    y: minY,
  };
};

const centerOf = (rect: { height: number; width: number; x: number; y: number }) => ({
  x: rect.x + Math.round(rect.width / 2),
  y: rect.y + Math.round(rect.height / 2),
});

const averagePixel = (
  frame: Awaited<ReturnType<typeof videoFrame>>,
  point: { x: number; y: number },
) => {
  const radius = 3;
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;

  for (let y = point.y - radius; y <= point.y + radius; y += 1) {
    for (let x = point.x - radius; x <= point.x + radius; x += 1) {
      if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) {
        continue;
      }

      const offset = (y * frame.width + x) * 3;
      red += frame.data[offset];
      green += frame.data[offset + 1];
      blue += frame.data[offset + 2];
      count += 1;
    }
  }

  return {
    blue: Math.round(blue / count),
    green: Math.round(green / count),
    red: Math.round(red / count),
  };
};
