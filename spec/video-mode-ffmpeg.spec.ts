import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { promisify } from "node:util";
import { test, expect } from "@playwright/test";
import { addPlugins, spinnerWaiter, videoMode } from "../src/index.ts";

const execFile = promisify(execFileCallback);

test.use({ video: "on" });

test("writes a rendered video with dead air sped up and highlights added in post", async ({
  page,
}, testInfo) => {
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [
      spinnerWaiter(),
      videoMode({
        deadAirThreshold: 300,
        finalHold: 700,
        highlight: { mode: "pointer", duration: 1000 },
      }),
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
});

test("writes video-mode artifact files and report player", async ({ page }, testInfo) => {
  const deadAirThresholdMs = 300;
  const finalHoldMs = 500;
  const highlightDurationMs = 600;
  const video = videoMode({
    deadAirThreshold: deadAirThresholdMs,
    finalHold: finalHoldMs,
    highlight: { mode: "pointer", duration: highlightDurationMs },
  });
  {
    await using plugged = await addPlugins({
      page,
      testInfo,
      plugins: [video],
    });
    await plugged.setContent(`
      <button id="save">Save</button>
      <div id="status"></div>
      <script>
        document.querySelector('#save').addEventListener('click', () => {
          document.querySelector('#status').textContent = 'saved';
        });
      </script>
    `);

    await plugged.videoMode.deadAir(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    });
    await plugged.locator("#save").click();
    await expect(plugged.locator("#status")).toContainText("saved");
  }

  const paths = video.outputPaths();
  const metadata = await video.metadata();
  expect(metadata).toMatchObject({
    outputs: {
      player: "video-mode.html",
      rendered: "video-rendered.webm",
      raw: "video-raw.webm",
    },
  });
  expect(metadata.deadAir.some((span) => span.end - span.start >= 1000)).toBe(true);
  expect(metadata.highlights.length).toBeGreaterThanOrEqual(1);

  const rawStats = await stat(paths.raw);
  const renderedStats = await stat(paths.rendered);
  const playerStats = await stat(paths.player);
  const reportPlayerStats = await stat(paths.reportPlayer);

  expect(rawStats.size).toBeGreaterThan(0);
  expect(renderedStats.size).toBeGreaterThan(0);
  expect(playerStats.size).toBeGreaterThan(0);
  expect(reportPlayerStats.size).toBeGreaterThan(0);
  await expect(readFile(paths.player, "utf8")).resolves.toContain('src="video-rendered.webm"');
  await expect(readFile(paths.player, "utf8")).resolves.toContain('src="video-raw.webm"');
  await expect(readFile(paths.player, "utf8")).resolves.toContain("<details>");
  await expect(readFile(paths.reportPlayer, "utf8")).resolves.toContain(
    `src="${await playwrightReportAttachmentName(paths.rendered)}"`,
  );
  await expect(readFile(paths.reportPlayer, "utf8")).resolves.toContain(
    `src="${await playwrightReportAttachmentName(paths.raw)}"`,
  );

  const rawDuration = await videoDurationMs(paths.raw);
  const renderedDuration = await videoDurationMs(paths.rendered);
  const expectedRenderedDuration =
    rawDuration -
    compressedDeadAirSavings(metadata.deadAir, deadAirThresholdMs) +
    metadata.highlights.reduce(
      (duration: number, highlight: { end: number; start: number }) =>
        duration + highlight.end - highlight.start,
      0,
    ) +
    finalHoldMs;

  expect(renderedDuration).toBeLessThan(rawDuration + metadata.highlights.length * highlightDurationMs);
  expect(Math.abs(renderedDuration - expectedRenderedDuration)).toBeLessThan(1500);
});

test("speeds dead air up instead of cutting through it", async ({ page }, testInfo) => {
  const deadAirThresholdMs = 500;
  const video = videoMode({
    deadAirThreshold: deadAirThresholdMs,
    finalHold: 0,
    highlight: { mode: "pointer", duration: 0 },
  });
  {
    await using plugged = await addPlugins({
      page,
      testInfo,
      plugins: [video],
    });
    await plugged.setViewportSize({ width: 400, height: 300 });
    await plugged.setContent(`
      <style>
        html, body {
          margin: 0;
          width: 400px;
          height: 300px;
          background: rgb(255, 255, 255);
        }
        #progress {
          position: absolute;
          left: 120px;
          top: 90px;
          width: 160px;
          height: 120px;
          background: rgb(255, 0, 0);
        }
      </style>
      <div id="progress"></div>
    `);

    await plugged.videoMode.deadAir(async () => {
      await plugged.evaluate(() => {
        const box = document.querySelector("#progress") as HTMLElement;
        const startedAt = performance.now();
        const duration = 1600;
        const update = () => {
          const progress = Math.min(1, (performance.now() - startedAt) / duration);
          const red = Math.round(255 * (1 - progress));
          const blue = Math.round(255 * progress);
          box.style.background = `rgb(${red}, 0, ${blue})`;
          if (progress < 1) requestAnimationFrame(update);
        };
        update();
      });
      await plugged.waitForTimeout(1600);
    });
  }

  const metadata = await video.metadata();
  const paths = video.outputPaths();
  const [span] = metadata.deadAir.filter((candidate) => candidate.end - candidate.start >= 1400);
  expect(span).toMatchObject({
    end: expect.any(Number),
    start: expect.any(Number),
  });

  const sourceMidpoint = span.start + Math.round((span.end - span.start) / 2);
  const renderedMidpoint = renderedTimestampForSourceTimestamp(
    sourceMidpoint,
    metadata.deadAir,
    deadAirThresholdMs,
  );
  const frame = await videoFrame(paths.rendered, renderedMidpoint);
  const middleColor = averagePixel(frame, { x: 200, y: 150 });

  expect(middleColor.red).toBeGreaterThan(80);
  expect(middleColor.blue).toBeGreaterThan(80);
});

test("renders only the selected video source range", async ({ page }, testInfo) => {
  const video = videoMode({
    finalHold: 0,
    highlight: { mode: "pointer", duration: 0 },
  });
  {
    await using plugged = await addPlugins({
      page,
      testInfo,
      plugins: [video],
    });
    await plugged.setContent(`
      <main style="font: 24px sans-serif">source range</main>
    `);

    await plugged.waitForTimeout(700);
    plugged.videoMode.setStartTime();
    await plugged.waitForTimeout(1100);
    plugged.videoMode.setEndTime();
    await plugged.waitForTimeout(700);
  }

  const metadata = await video.metadata();
  expect(metadata.sourceRange).toMatchObject({
    end: expect.any(Number),
    start: expect.any(Number),
  });

  const paths = video.outputPaths();
  const rawDuration = await videoDurationMs(paths.raw);
  const renderedDuration = await videoDurationMs(paths.rendered);
  const expectedRenderedDuration = metadata.sourceRange.end! - metadata.sourceRange.start!;

  expect(rawDuration).toBeGreaterThan(expectedRenderedDuration + 500);
  expect(Math.abs(renderedDuration - expectedRenderedDuration)).toBeLessThan(700);
});

test("skips rendering an empty selected video source range", async ({ page }, testInfo) => {
  const video = videoMode({
    finalHold: 0,
    highlight: false,
  });
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args) => {
    warnings.push(args.map(String).join(" "));
    originalWarn(...args);
  };

  try {
    {
      await using plugged = await addPlugins({
        page,
        testInfo,
        plugins: [video],
      });
      await plugged.setContent(`
        <main style="font: 24px sans-serif">empty source range</main>
      `);

      plugged.videoMode.setStartTime(0);
      plugged.videoMode.setEndTime(0);
      await plugged.waitForTimeout(100);
    }

    const metadata = await video.metadata();
    const paths = video.outputPaths();

    expect(metadata).toMatchObject({
      outputs: {
        player: "video-mode.html",
        raw: "video-raw.webm",
      },
      sourceRange: {
        end: 0,
        start: 0,
      },
    });
    expect(metadata.outputs.rendered).toBeUndefined();
    expect(warnings).toEqual([
      expect.stringContaining("videoMode source range is empty: start 0ms must be before end 0ms"),
    ]);
    await expect(stat(paths.raw)).resolves.toMatchObject({ size: expect.any(Number) });
    await expect(stat(paths.rendered)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(paths.player, "utf8")).resolves.toContain('src="video-raw.webm"');
    await expect(readFile(paths.player, "utf8")).resolves.not.toContain('src="video-rendered.webm"');
  } finally {
    console.warn = originalWarn;
  }
});

test("renders calibrated highlight boxes on a paused pre-click frame", async ({ page }, testInfo) => {
  const highlightDurationMs = 900;
  const video = videoMode({
    finalHold: 0,
    highlight: { mode: "outline", duration: highlightDurationMs, style: "8px solid yellow" },
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

  const paths = video.outputPaths();
  const metadata = await video.metadata();
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

  const renderedPath = paths.rendered;
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

test("hides the pointer cursor after the last highlighted action", async ({ page }, testInfo) => {
  const highlightDurationMs = 700;
  const video = videoMode({
    finalHold: 900,
    highlight: { mode: "pointer", duration: highlightDurationMs },
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
          left: 180px;
          top: 120px;
          width: 180px;
          height: 120px;
          background: rgb(0, 80, 255);
        }
        #target.clicked {
          background: rgb(0, 190, 0);
        }
      </style>
      <div id="target" onclick="this.classList.add('clicked')"></div>
    `);

    await plugged.locator("#target").click();
    await expect(plugged.locator("#target")).toHaveClass("clicked");
    await page.waitForTimeout(300);
  }

  const paths = video.outputPaths();
  const metadata = await video.metadata();
  const [highlight] = metadata.highlights;
  expect(highlight).toBeDefined();

  const renderedPath = paths.rendered;
  const clickHoldFrame = await videoFrame(
    renderedPath,
    highlight.start + highlightDurationMs - 100,
  );
  const finalHoldFrame = await videoFrame(renderedPath, (await videoDurationMs(renderedPath)) - 100);
  const scale = Math.min(
    clickHoldFrame.width / highlight.viewport.width,
    clickHoldFrame.height / highlight.viewport.height,
  );
  const targetBox = {
    height: Math.round(highlight.rect.height * scale),
    width: Math.round(highlight.rect.width * scale),
    x: Math.round(highlight.rect.x * scale),
    y: Math.round(highlight.rect.y * scale),
  };

  expect(cursorPixelCount(clickHoldFrame, targetBox)).toBeGreaterThan(40);
  expect(cursorPixelCount(finalHoldFrame, targetBox)).toBeLessThan(10);
});

test("moves the pointer toward the first click after a waitFor", async ({ page }, testInfo) => {
  const highlightDurationMs = 700;
  const video = videoMode({
    finalHold: 0,
    highlight: { mode: "pointer", duration: highlightDurationMs },
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
          background: rgb(210, 210, 210);
        }
        #ready {
          visibility: hidden;
          position: absolute;
          left: 80px;
          top: 140px;
          width: 140px;
          height: 100px;
          background: rgb(0, 80, 255);
        }
        #run {
          position: absolute;
          left: 560px;
          top: 140px;
          width: 140px;
          height: 100px;
          border: 0;
          padding: 0;
          background: rgb(0, 190, 0);
        }
      </style>
      <div id="ready"></div>
      <button id="run" onclick="document.body.dataset.clicked = 'true'"></button>
      <script>
        setTimeout(() => {
          document.querySelector('#ready').style.visibility = 'visible';
        }, 200);
      </script>
    `);

    await plugged.locator("#ready").waitFor();
    await plugged.waitForTimeout(900);
    await plugged.locator("#run").click();
    await expect(plugged.locator("body")).toHaveAttribute("data-clicked", "true");
    await page.waitForTimeout(200);
  }

  const paths = video.outputPaths();
  const metadata = await video.metadata();
  const [highlight] = metadata.highlights;
  expect(highlight).toBeDefined();

  const renderedPath = paths.rendered;
  const preClickFrame = await videoFrame(renderedPath, Math.max(100, highlight.start - 650));
  const clickHoldFrame = await videoFrame(
    renderedPath,
    highlight.start + highlightDurationMs - 100,
  );
  const scale = Math.min(
    preClickFrame.width / highlight.viewport.width,
    preClickFrame.height / highlight.viewport.height,
  );
  const runBox = {
    height: Math.round(highlight.rect.height * scale),
    width: Math.round(highlight.rect.width * scale),
    x: Math.round(highlight.rect.x * scale),
    y: Math.round(highlight.rect.y * scale),
  };
  const fullFrame = {
    height: preClickFrame.height,
    width: preClickFrame.width,
    x: 0,
    y: 0,
  };

  expect(cursorPixelCount(preClickFrame, fullFrame)).toBeGreaterThan(20);
  expect(cursorPixelCount(preClickFrame, runBox)).toBeLessThan(10);
  expect(cursorPixelCount(clickHoldFrame, runBox)).toBeGreaterThan(40);
});

test("holds the text cursor for fill and type after the pointer arrives", async ({
  page,
}, testInfo) => {
  const highlightDurationMs = 1000;
  const video = videoMode({
    finalHold: 0,
    highlight: { mode: "pointer", duration: highlightDurationMs },
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
          background: rgb(210, 210, 210);
        }
        input,
        textarea {
          border: 0;
          box-sizing: border-box;
          caret-color: transparent;
          color: inherit;
          font: 32px sans-serif;
          outline: 0;
          padding: 0;
          position: absolute;
          resize: none;
        }
        #name {
          background: rgb(0, 80, 255);
          color: rgb(0, 80, 255);
          height: 120px;
          left: 560px;
          top: 80px;
          width: 160px;
        }
        #notes {
          background: rgb(0, 190, 0);
          color: rgb(0, 190, 0);
          height: 120px;
          left: 80px;
          top: 360px;
          width: 180px;
        }
      </style>
      <input id="name" aria-label="name" />
      <textarea id="notes" aria-label="notes"></textarea>
    `);

    await plugged.locator("#name").fill("Ada");
    await expect(plugged.locator("#name")).toHaveValue("Ada");
    await plugged.locator("#notes").type("notes");
    await expect(plugged.locator("#notes")).toHaveValue("notes");
    await page.waitForTimeout(200);
  }

  const paths = video.outputPaths();
  const metadata = await video.metadata();
  const fillHighlight = metadata.highlights.find((highlight) => highlight.method === "fill")!;
  const typeHighlight = metadata.highlights.find((highlight) => highlight.method === "type")!;
  expect(fillHighlight).toBeDefined();
  expect(typeHighlight).toBeDefined();

  const renderedPath = paths.rendered;
  const fillStart = renderedHighlightStartWithoutDeadAir(fillHighlight, metadata.highlights);
  const typeStart = renderedHighlightStartWithoutDeadAir(typeHighlight, metadata.highlights);
  const fillEarlyRestFrame = await videoFrame(renderedPath, fillStart + 300);
  const fillLateRestFrame = await videoFrame(renderedPath, fillStart + highlightDurationMs - 100);
  const typeEarlyRestFrame = await videoFrame(renderedPath, typeStart + 300);
  const typeLateRestFrame = await videoFrame(renderedPath, typeStart + highlightDurationMs - 100);
  const scale = Math.min(
    fillLateRestFrame.width / fillHighlight.viewport.width,
    fillLateRestFrame.height / fillHighlight.viewport.height,
  );
  const fillBox = {
    height: Math.round(fillHighlight.rect.height * scale),
    width: Math.round(fillHighlight.rect.width * scale),
    x: Math.round(fillHighlight.rect.x * scale),
    y: Math.round(fillHighlight.rect.y * scale),
  };
  const typeBox = {
    height: Math.round(typeHighlight.rect.height * scale),
    width: Math.round(typeHighlight.rect.width * scale),
    x: Math.round(typeHighlight.rect.x * scale),
    y: Math.round(typeHighlight.rect.y * scale),
  };

  expect(textCursorPixelCount(fillEarlyRestFrame, fillBox)).toBeGreaterThan(35);
  expect(textCursorPixelCount(fillLateRestFrame, fillBox)).toBeGreaterThan(35);
  expect(textCursorPixelCount(typeEarlyRestFrame, typeBox)).toBeGreaterThan(35);
  expect(textCursorPixelCount(typeLateRestFrame, typeBox)).toBeGreaterThan(35);
});

test("does not linger on the unhighlighted post-wait state before a following highlight", async ({
  page,
}, testInfo) => {
  const video = videoMode({
    deadAirThreshold: 300,
    finalHold: 0,
    highlight: { mode: "outline", duration: 600, style: "10px solid yellow" },
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

  const paths = video.outputPaths();
  const metadata = await video.metadata();
  const nextHighlight = metadata.highlights.find((highlight) => highlight.rect.x > 300)!;
  expect(nextHighlight).toBeDefined();

  const renderedPath = paths.rendered;
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

  expect(unhighlightedReadyFrames.length).toBeLessThanOrEqual(2);
  for (const index of unhighlightedReadyFrames) {
    expect(index).toBeGreaterThanOrEqual(highlightStartFrame - 2);
  }
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

const compressedDeadAirSavings = (deadAir: VideoSpan[], thresholdMs: number) => {
  return deadAir.reduce((savedDuration, span) => {
    const duration = span.end - span.start;
    return savedDuration + Math.max(0, duration - thresholdMs);
  }, 0);
};

const renderedTimestampForSourceTimestamp = (
  sourceTimestamp: number,
  deadAir: VideoSpan[],
  thresholdMs: number,
) => {
  return sourceTimestamp - deadAir.reduce((savedDuration, span) => {
    if (sourceTimestamp <= span.start) {
      return savedDuration;
    }

    const duration = span.end - span.start;
    if (duration <= thresholdMs) {
      return savedDuration;
    }

    const sourceDurationInSpan = Math.min(sourceTimestamp, span.end) - span.start;
    const renderedDurationInSpan = sourceDurationInSpan * (thresholdMs / duration);
    return savedDuration + sourceDurationInSpan - renderedDurationInSpan;
  }, 0);
};

const renderedHighlightStartWithoutDeadAir = (
  highlight: { start: number },
  highlights: { end: number; start: number }[],
) => {
  return (
    highlight.start +
    highlights
      .filter((candidate) => candidate.start < highlight.start)
      .reduce((duration, candidate) => duration + candidate.end - candidate.start, 0)
  );
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

const cursorPixelCount = (
  frame: VideoFrame,
  rect: { height: number; width: number; x: number; y: number },
) => {
  return countPixels(frame, inset(rect, 12), ({ blue, green, red }) => {
    const nearlyWhite = red > 230 && green > 230 && blue > 230;
    const nearlyBlack = red < 35 && green < 35 && blue < 35;
    return nearlyWhite || nearlyBlack;
  });
};

const textCursorPixelCount = (
  frame: VideoFrame,
  rect: { height: number; width: number; x: number; y: number },
) => {
  const center = centerOf(rect);

  return countPixels(
    frame,
    {
      height: 36,
      width: 10,
      x: center.x - 5,
      y: center.y - 18,
    },
    ({ blue, green, red }) => {
      const nearlyWhite = red > 230 && green > 230 && blue > 230;
      const nearlyBlack = red < 35 && green < 35 && blue < 35;
      return nearlyWhite || nearlyBlack;
    },
  );
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
