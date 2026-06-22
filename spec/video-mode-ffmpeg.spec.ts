import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
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
      player: "video-mode.html",
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
  const playerPath = join(testInfo.outputDir, metadata.outputs.player);
  const reportPlayerPath = join(testInfo.outputDir, "video-mode-report.html");
  const rawStats = await stat(rawPath);
  const renderedStats = await stat(renderedPath);
  const playerStats = await stat(playerPath);
  const reportPlayerStats = await stat(reportPlayerPath);
  console.log(`raw video written to ${rawPath}`);
  console.log(`rendered video written to ${renderedPath}`);
  console.log(`video player written to ${playerPath}`);
  console.log(`report video player written to ${reportPlayerPath}`);

  expect(rawStats.size).toBeGreaterThan(0);
  expect(renderedStats.size).toBeGreaterThan(0);
  expect(playerStats.size).toBeGreaterThan(0);
  expect(reportPlayerStats.size).toBeGreaterThan(0);
  await expect(readFile(playerPath, "utf8")).resolves.toContain('src="video-rendered.webm"');
  await expect(readFile(playerPath, "utf8")).resolves.toContain('src="video-raw.webm"');
  await expect(readFile(playerPath, "utf8")).resolves.toContain("<details>");
  await expect(readFile(reportPlayerPath, "utf8")).resolves.toContain(
    `src="${await playwrightReportAttachmentName(renderedPath)}"`,
  );
  await expect(readFile(reportPlayerPath, "utf8")).resolves.toContain(
    `src="${await playwrightReportAttachmentName(rawPath)}"`,
  );

  const rawDuration = await videoDurationMs(rawPath);
  const renderedDuration = await videoDurationMs(renderedPath);
  const expectedRenderedDuration =
    rawDuration -
    trimmedDeadAirDuration(metadata.deadAir, metadata.highlights, deadAirThresholdMs) +
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

  const rawPath = join(testInfo.outputDir, metadata.outputs.raw);
  console.log(`raw video written to ${rawPath}`);
  console.log(`rendered video written to ${renderedPath}`);
});

test("does not flash the unhighlighted post-wait state before a following highlight", async ({
  page,
}, testInfo) => {
  const video = videoMode({
    deadAirThreshold: 300,
    finalHold: 0,
    highlightColor: "yellow",
    highlightDuration: 600,
    highlightThickness: 10,
  });
  {
    await using plugged = await addPlugins({
      page,
      testInfo,
      plugins: [
        spinnerWaiter({
          spinnerSelectors: ['[data-spinner="true"]'],
          spinnerTimeout: 6000,
        }),
        video,
      ],
    });
    await plugged.setViewportSize({ width: 800, height: 600 });
    await plugged.setContent(`
      <style>
        html, body {
          margin: 0;
          width: 800px;
          height: 600px;
          background: rgb(0, 0, 0);
        }
        button {
          border: 0;
          color: rgb(0, 0, 0);
          font: 20px sans-serif;
          position: absolute;
          top: 180px;
          width: 180px;
          height: 80px;
        }
        #start {
          left: 80px;
          background: rgb(0, 80, 255);
        }
        #next {
          left: 340px;
          background: rgb(0, 190, 0);
        }
        #next:disabled {
          background: rgb(70, 70, 70);
        }
        [data-spinner="true"] {
          position: absolute;
          left: 340px;
          top: 60px;
          width: 180px;
          height: 80px;
          background: rgb(230, 0, 0);
          visibility: hidden;
        }
      </style>
      <button id="start">start</button>
      <button id="next" disabled>next</button>
      <div data-spinner="true"></div>
      <div id="done"></div>
      <script>
        const spinner = document.querySelector('[data-spinner="true"]');
        const next = document.querySelector('#next');
        document.querySelector('#start').addEventListener('click', () => {
          next.disabled = true;
          spinner.style.visibility = 'visible';
          setTimeout(() => {
            spinner.style.visibility = 'hidden';
            next.disabled = false;
          }, 1250);
        });
        next.addEventListener('click', () => {
          document.querySelector('#done').textContent = 'done';
        });
      </script>
    `);

    await plugged.locator("#start").click();
    await plugged.locator("#next").click();
    await expect(plugged.locator("#done")).toContainText("done");
    await page.waitForTimeout(300);
  }

  const metadata = JSON.parse(
    await readFile(join(testInfo.outputDir, "video-mode.json"), "utf8"),
  );
  const nextHighlight = metadata.highlights.find(
    (highlight: { rect: { x: number } }) => highlight.rect.x > 300,
  );
  expect(nextHighlight).toBeTruthy();

  const renderedPath = join(testInfo.outputDir, metadata.outputs.rendered);
  const frames = await videoFrames(renderedPath);
  const scale = Math.min(
    frames[0].width / nextHighlight.viewport.width,
    frames[0].height / nextHighlight.viewport.height,
  );
  const nextBox = {
    height: Math.round(nextHighlight.rect.height * scale),
    width: Math.round(nextHighlight.rect.width * scale),
    x: Math.round(nextHighlight.rect.x * scale),
    y: Math.round(nextHighlight.rect.y * scale),
  };
  const samples = frames.map((frame, index) => ({
    highlighted: hasYellow(frame, nextBox),
    index,
    ready: hasGreen(frame, inset(nextBox, 14)),
  }));
  const highlightStartFrame = samples.findIndex((sample) => sample.highlighted);
  expect(highlightStartFrame).toBeGreaterThan(0);

  const unhighlightedReadyFrames = samples
    .slice(Math.max(0, highlightStartFrame - 8), highlightStartFrame)
    .filter((sample) => sample.ready && !sample.highlighted)
    .map((sample) => sample.index);

  expect(unhighlightedReadyFrames).toEqual([]);

  const rawPath = join(testInfo.outputDir, metadata.outputs.raw);
  console.log(`raw video written to ${rawPath}`);
  console.log(`rendered video written to ${renderedPath}`);
});

const videoDurationMs = async (path: string) => {
  const { stdout } = await execFile(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nokey=1:noprint_wrappers=1", path],
    { maxBuffer: 1024 * 1024 },
  );

  return Math.round(Number(stdout.trim()) * 1000);
};

type VideoFrame = {
  data: Buffer;
  height: number;
  width: number;
};

type VideoSpan = {
  end: number;
  start: number;
};

const playwrightReportAttachmentName = async (path: string) => {
  const data = await readFile(path);
  return `${createHash("sha1").update(data).digest("hex")}${extname(path)}`;
};

const trimmedDeadAirDuration = (
  deadAir: VideoSpan[],
  highlights: VideoSpan[],
  thresholdMs: number,
) => {
  return deadAir.reduce((removedDuration, span) => {
    if (span.end - span.start <= thresholdMs) {
      return removedDuration;
    }

    const followingHighlight = highlights.find((highlight) => {
      return highlight.start >= span.end && highlight.start - span.end <= thresholdMs;
    });
    const padding = thresholdMs / 2;
    const trimStart = Math.round(span.start + padding);
    const trimEnd = Math.round(followingHighlight ? followingHighlight.start : span.end - padding);

    return removedDuration + Math.max(0, trimEnd - trimStart);
  }, 0);
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

const videoFrame = async (path: string, timestampMs: number): Promise<VideoFrame> => {
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

const videoFrames = async (path: string): Promise<VideoFrame[]> => {
  const info = await videoInfo(path);
  const { stdout } = await execFile(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      path,
      "-vf",
      "fps=25",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ],
    {
      encoding: "buffer",
      maxBuffer: 128 * 1024 * 1024,
    },
  );
  const frameSize = info.width * info.height * 3;
  const frames: VideoFrame[] = [];

  for (let offset = 0; offset + frameSize <= stdout.length; offset += frameSize) {
    frames.push({
      data: (stdout as Buffer).subarray(offset, offset + frameSize),
      height: info.height,
      width: info.width,
    });
  }

  return frames;
};

const yellowBoundingBox = (frame: VideoFrame) => {
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

const averagePixel = (frame: VideoFrame, point: { x: number; y: number }) => {
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

const inset = (rect: { height: number; width: number; x: number; y: number }, amount: number) => ({
  height: Math.max(1, rect.height - amount * 2),
  width: Math.max(1, rect.width - amount * 2),
  x: rect.x + amount,
  y: rect.y + amount,
});

const hasYellow = (
  frame: VideoFrame,
  rect: { height: number; width: number; x: number; y: number },
) => {
  return countPixels(frame, rect, ({ blue, green, red }) => red > 180 && green > 160 && blue < 100) > 20;
};

const hasGreen = (
  frame: VideoFrame,
  rect: { height: number; width: number; x: number; y: number },
) => {
  return countPixels(frame, rect, ({ blue, green, red }) => green > 120 && red < 80 && blue < 80) > 200;
};

const countPixels = (
  frame: VideoFrame,
  rect: { height: number; width: number; x: number; y: number },
  predicate: (pixel: { blue: number; green: number; red: number }) => boolean,
) => {
  let count = 0;
  const startX = Math.max(0, rect.x);
  const endX = Math.min(frame.width, rect.x + rect.width);
  const startY = Math.max(0, rect.y);
  const endY = Math.min(frame.height, rect.y + rect.height);

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const offset = (y * frame.width + x) * 3;
      if (
        predicate({
          blue: frame.data[offset + 2],
          green: frame.data[offset + 1],
          red: frame.data[offset],
        })
      ) {
        count += 1;
      }
    }
  }

  return count;
};
