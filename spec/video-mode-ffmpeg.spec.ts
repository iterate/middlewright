import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { test, expect } from "@playwright/test";
import { addPlugins, spinnerWaiter, videoMode } from "../src/index.ts";
import type { Plugin } from "../src/index.ts";

const execFile = promisify(execFileCallback);

test.use({ video: "on" });

test("turns meaningful Playwright steps into readable video captions", async ({
  page,
}, testInfo) => {
  const deadAirThresholdMs = 300;
  const finalHoldMs = 1200;
  const highlightDurationMs = 900;
  const video = videoMode({
    deadAirThreshold: deadAirThresholdMs,
    finalHold: finalHoldMs,
    highlight: { mode: "pointer", duration: highlightDurationMs },
    trimStart: "never",
  });
  {
    await using plugged = await addPlugins({
      page,
      testInfo,
      plugins: [video],
    });
    await plugged.setViewportSize({ width: 800, height: 450 });
    await plugged.setContent(`
      <main>
        <section data-view="account">
          <h1>Create your account</h1>
          <label>
            Work email
            <input aria-label="Work email" type="email" />
          </label>
          <button id="account-next">Continue</button>
          <p id="account-status" role="status"></p>
        </section>
        <section data-view="plan" hidden>
          <h1>Choose a plan</h1>
          <div>
            <button data-plan="Starter">Starter</button>
            <button data-plan="Pro">Pro</button>
          </div>
          <button id="plan-next" disabled>Continue</button>
          <p id="plan-status" role="status"></p>
        </section>
        <section data-view="review" hidden>
          <h1>Review subscription</h1>
          <p id="summary"></p>
          <button id="confirm">Confirm subscription</button>
          <p id="review-status" role="status"></p>
        </section>
        <section data-view="success" hidden>
          <h1>Welcome to Pro</h1>
          <p>Your account is ready.</p>
        </section>
      </main>
      <script>
        const views = Object.fromEntries(
          Array.from(document.querySelectorAll('[data-view]')).map((view) => [
            view.dataset.view,
            view,
          ]),
        );
        const show = (name) => {
          Object.values(views).forEach((view) => {
            view.hidden = view.dataset.view !== name;
          });
        };
        let selectedPlan = '';

        document.querySelector('#account-next').addEventListener('click', () => {
          document.querySelector('#account-next').disabled = true;
          document.querySelector('#account-status').textContent = 'Saving account…';
          setTimeout(() => show('plan'), 700);
        });
        document.querySelectorAll('[data-plan]').forEach((button) => {
          button.addEventListener('click', () => {
            selectedPlan = button.dataset.plan;
            document.querySelector('#plan-next').disabled = false;
          });
        });
        document.querySelector('#plan-next').addEventListener('click', () => {
          document.querySelector('#summary').textContent =
            document.querySelector('[aria-label="Work email"]').value + ' · ' + selectedPlan;
          document.querySelector('#plan-next').disabled = true;
          document.querySelector('#plan-status').textContent = 'Preparing review…';
          setTimeout(() => show('review'), 700);
        });
        document.querySelector('#confirm').addEventListener('click', () => {
          document.querySelector('#confirm').disabled = true;
          document.querySelector('#review-status').textContent = 'Creating subscription…';
          setTimeout(() => show('success'), 700);
        });
      </script>
    `);

    await test.step("Enter account details", async () => {
      await plugged.getByLabel("Work email").fill("ada@example.com");
      await plugged.getByRole("button", { name: "Continue" }).click();
      const planHeading = plugged.getByRole("heading", { name: "Choose a plan" });
      await planHeading.waitFor();
      await expect(planHeading).toBeVisible();
    });
    await test.step("Choose the Pro plan", async () => {
      await plugged.getByRole("button", { name: "Pro" }).click();
      await plugged.getByRole("button", { name: "Continue" }).click();
      const reviewHeading = plugged.getByRole("heading", { name: "Review subscription" });
      await reviewHeading.waitFor();
      await expect(reviewHeading).toBeVisible();
      await expect(plugged.locator("#summary")).toContainText("ada@example.com · Pro");
    });
    await test.step("Confirm the subscription", async () => {
      await plugged.getByRole("button", { name: "Confirm subscription" }).click();
      const successHeading = plugged.getByRole("heading", { name: "Welcome to Pro" });
      await successHeading.waitFor();
      await expect(successHeading).toBeVisible();
    });
  }

  const paths = video.outputPaths();
  const metadata = await video.metadata();
  expect(metadata).toMatchObject({
    captions: [
      {
        end: expect.any(Number),
        start: expect.any(Number),
        text: "Enter account details",
      },
      {
        end: expect.any(Number),
        start: expect.any(Number),
        text: "Choose the Pro plan",
      },
      {
        end: expect.any(Number),
        start: expect.any(Number),
        text: "Confirm the subscription",
      },
    ],
    outputs: {
      rendered: "video-rendered.webm",
    },
  });
  expect(metadata.deadAir.some((span) => span.end - span.start >= 600)).toBe(true);
  expect(metadata.highlights.map(({ method }) => method)).toEqual([
    "fill",
    "click",
    "click",
    "click",
    "click",
  ]);

  const renderedDurationMs = await videoDurationMs(paths.rendered);
  const captionFrames = await Promise.all(
    [0.15, 0.45, 0.7].map((progress) => videoFrame(paths.rendered, renderedDurationMs * progress)),
  );
  for (const frame of captionFrames) {
    const captionArea = {
      height: Math.round(frame.height * 0.16),
      width: frame.width,
      x: 0,
      y: Math.round(frame.height * 0.84),
    };
    expect(
      countPixels(
        frame,
        captionArea,
        ({ blue, green, red }) => red > 220 && green > 220 && blue > 220,
      ),
    ).toBeGreaterThan(100);
  }
  expect(renderedDurationMs).toBeGreaterThan(
    finalHoldMs + metadata.highlights.length * highlightDurationMs,
  );
});

test("keeps captions aligned through trimming and dead-air compression", async ({
  page,
}, testInfo) => {
  const video = videoMode({
    captions: "explicit",
    deadAirThreshold: 200,
    finalHold: 0,
    highlight: false,
    trimStart: "never",
  });
  {
    await using plugged = await addPlugins({
      page,
      testInfo,
      plugins: [video],
    });
    await plugged.setViewportSize({ width: 800, height: 600 });
    await plugged.setContent(`
      <main style="position: fixed; inset: 0; background: rgb(30, 40, 80)"></main>
    `);

    await plugged.videoMode.caption("Process account data", async () => {
      await plugged.waitForTimeout(100);
      plugged.videoMode.setStartTime();
      await plugged.videoMode.deadAir(async () => {
        await plugged.waitForTimeout(700);
      });
    });
  }

  const paths = video.outputPaths();
  const metadata = await video.metadata();
  expect(metadata).toMatchObject({
    captions: [{ text: "Process account data" }],
    outputs: { rendered: "video-rendered.webm" },
    sourceRange: { start: expect.any(Number) },
  });

  const frame = await videoFrame(paths.rendered, 100);
  const whiteCaptionPixels = countPixels(
    frame,
    {
      height: Math.round(frame.height * 0.3),
      width: frame.width,
      x: 0,
      y: Math.round(frame.height * 0.7),
    },
    ({ blue, green, red }) => red > 220 && green > 220 && blue > 220,
  );

  expect(whiteCaptionPixels).toBeGreaterThan(100);
  expect(await videoDurationMs(paths.rendered)).toBeLessThan(
    (await videoDurationMs(paths.raw)) - 300,
  );
});

test("writes a rendered video with dead air sped up and highlights added in post", async ({
  page,
}, testInfo) => {
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [
      spinnerWaiter(),
      videoMode({ trimStart: "never",
        deadAirThreshold: 300,
        finalHold: 700,
        highlight: { mode: "pointer", duration: 1000 },
      }),
    ],
  });
  await plugged.setViewportSize({ width: 800, height: 600 });
  await plugged.setContent(`
    <main>
      <div data-spinner="true" hidden>Loading...</div>
      <div>
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
        spinner.hidden = true;
        buttons.forEach((button, buttonIndex) => {
          button.disabled = buttonIndex !== index;
        });
      }

      buttons.forEach((button) => {
        button.addEventListener('click', async () => {
          buttons.forEach((button) => {
            button.disabled = true;
          });
          spinner.hidden = false;

          const index = Number(button.dataset.stageIndex);
          const stage = stages[index];
          await sleep(stage.delay);

          if (stage.done) {
            spinner.hidden = true;
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
  const video = videoMode({ trimStart: "never",
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
  await expect(readFile(paths.player, "utf8")).resolves.toContain(
    'data-active-key="rendered"',
  );
  await expect(readFile(paths.player, "utf8")).resolves.toContain('data-active-key="raw"');
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

  const playerUrl = new URL(pathToFileURL(paths.player).href);
  playerUrl.searchParams.set("active", "rendered");
  playerUrl.searchParams.set("frame", "2");
  const playerPage = await page.context().newPage();
  await playerPage.goto(playerUrl.href);
  await expect(playerPage.locator("#active")).toHaveText("Rendered video");
  await expect(playerPage.locator("#frame")).toHaveText("2");
  await playerPage.keyboard.press("ArrowRight");
  await expect(playerPage.locator("#frame")).toHaveText("3");
  expect(new URL(playerPage.url()).searchParams.get("active")).toBe("rendered");
  expect(new URL(playerPage.url()).searchParams.get("frame")).toBe("3");
  await playerPage.close();
});

test("keeps the page open for later afterTest hooks", async ({ page }, testInfo) => {
  const afterTestEvents: string[] = [];
  const afterVideoMode = {
    name: "after-video-mode",
    testLifecycle: (emitter) => {
      return emitter.on("afterTest", async ({ page }) => {
        afterTestEvents.push(page.isClosed() ? "closed" : "open");
        await expect(page.locator("#after-test-hook-target")).toContainText("ready");
      });
    },
  } satisfies Plugin;
  const video = videoMode({ trimStart: "never",
    finalHold: 0,
    highlight: false,
  });

  {
    await using plugged = await addPlugins({
      page,
      testInfo,
      plugins: [video, afterVideoMode],
    });
    await plugged.setContent(`<main id="after-test-hook-target">ready</main>`);
  }

  expect(afterTestEvents).toEqual(["open"]);
});

test("speeds dead air up instead of cutting through it", async ({ page }, testInfo) => {
  const deadAirThresholdMs = 500;
  const video = videoMode({ trimStart: "never",
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
      <div id="progress" style="position: absolute; left: 120px; top: 90px; width: 160px; height: 120px; background: rgb(255, 0, 0)"></div>
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
  const video = videoMode({ trimStart: "never",
    finalHold: 0,
    highlight: { mode: "pointer", duration: 0 },
  });
  {
    await using plugged = await addPlugins({
      page,
      testInfo,
      plugins: [video],
    });
    await plugged.setContent("<main>source range</main>");

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
  const video = videoMode({ trimStart: "never",
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
      await plugged.setContent("<main>empty source range</main>");

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

test("holds the pre-click state without flashing the completed action state first", async ({
  page,
}, testInfo) => {
  const highlightDurationMs = 900;
  const video = videoMode({ trimStart: "never",
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
      <div id="target" style="position: absolute; left: 120px; top: 80px; width: 160px; height: 90px; background: rgb(0, 80, 255)" onclick="this.style.background = 'rgb(255, 0, 0)'"></div>
    `);

    await plugged.waitForTimeout(300);
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
  const renderedDurationMs = await videoDurationMs(renderedPath);
  const pauseFrame = await videoFrame(
    renderedPath,
    highlight.start + Math.round(highlightDurationMs / 2),
  );
  const afterClickFrame = await videoFrame(
    renderedPath,
    renderedDurationMs - 80,
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
  const completedStateBeforeHold = (await videoFrames(renderedPath))
    .slice(0, Math.ceil(highlight.start / 40))
    .map((frame, index) => ({
      color: averagePixel(frame, centerOf(expectedBox)),
      timestamp: index * 40,
    }))
    .filter(({ color }) => color.red > color.blue + 80);

  expect(yellowBox).toMatchObject({
    height: expect.closeTo(expectedBox.height, 4),
    width: expect.closeTo(expectedBox.width, 4),
    x: expect.closeTo(expectedBox.x, 3),
    y: expect.closeTo(expectedBox.y, 3),
  });
  expect(completedStateBeforeHold).toEqual([]);

  const pauseCenter = averagePixel(pauseFrame, centerOf(expectedBox));
  const afterClickCenter = averagePixel(afterClickFrame, centerOf(expectedBox));

  expect(pauseCenter).toMatchObject({
    blue: expect.any(Number),
    green: expect.any(Number),
    red: expect.any(Number),
  });
  expect(pauseCenter.blue).toBeGreaterThan(pauseCenter.red + 80);
  expect(afterClickCenter.red).toBeGreaterThan(afterClickCenter.blue + 80);
  expect(renderedDurationMs).toBeLessThan(
    (await videoDurationMs(paths.raw)) + highlightDurationMs - 400,
  );
});

test("renders an accepted confirm with a paused dialog and pointer click", async ({
  page,
}, testInfo) => {
  const highlightDurationMs = 900;
  const video = videoMode({
    finalHold: 0,
    highlight: { mode: "pointer", duration: highlightDurationMs },
    trimStart: "never",
  });
  {
    await using plugged = await addPlugins({
      page,
      testInfo,
      plugins: [video],
    });
    await plugged.setViewportSize({ width: 800, height: 600 });
    await plugged.setContent(`
      <body style="margin: 0; background: rgb(17, 24, 39)">
      <button id="discard">Discard file</button>
      <output id="result"></output>
      <script>
        document.querySelector("#discard").addEventListener("click", () => {
          document.querySelector("#result").textContent = confirm("Discard unsaved changes?")
            ? "Discarded!"
            : "Kept";
        });
      </script>
      </body>
    `);
    plugged.once("dialog", (dialog) => dialog.accept());

    await plugged.locator("#discard").click();

    await plugged.getByText("Discarded!", { exact: true }).waitFor();
  }

  const paths = video.outputPaths();
  const metadata = await video.metadata();
  const dialogHighlight = metadata.highlights.find(
    (highlight) => highlight.dialog?.type === "confirm",
  )!;
  expect(dialogHighlight).toMatchObject({
    dialog: {
      action: "accept",
      message: "Discard unsaved changes?",
      type: "confirm",
    },
    method: "click",
  });

  const renderedStart = renderedHighlightStartWithoutDeadAir(
    dialogHighlight,
    metadata.highlights,
  );
  const dialogFrame = await videoFrame(
    paths.rendered,
    renderedStart + highlightDurationMs - 100,
  );
  const scale = Math.min(
    dialogFrame.width / dialogHighlight.viewport.width,
    dialogFrame.height / dialogHighlight.viewport.height,
  );
  const buttonBox = {
    height: Math.round(dialogHighlight.rect.height * scale),
    width: Math.round(dialogHighlight.rect.width * scale),
    x: Math.round(dialogHighlight.rect.x * scale),
    y: Math.round(dialogHighlight.rect.y * scale),
  };
  const panelCenter = averagePixel(dialogFrame, {
    x: Math.round(dialogFrame.width / 2),
    y: Math.round(dialogFrame.height / 2),
  });

  expect(panelCenter).toMatchObject({
    blue: expect.any(Number),
    green: expect.any(Number),
    red: expect.any(Number),
  });
  expect(panelCenter.red).toBeGreaterThan(220);
  expect(panelCenter.green).toBeGreaterThan(220);
  expect(panelCenter.blue).toBeGreaterThan(220);
  expect(pointerTailPixelCount(dialogFrame, buttonBox)).toBeGreaterThan(20);

  const renderedFrames = await videoFrames(paths.rendered);
  const finalDarkFrameCount = [...renderedFrames]
    .reverse()
    .findIndex((frame) => {
      const center = averagePixel(frame, {
        x: Math.round(frame.width / 2),
        y: Math.round(frame.height / 2),
      });
      return center.red >= 80 || center.green >= 80 || center.blue >= 80;
    });
  // A one-second post-dialog view is 25 decoded frames. Depending on container
  // duration semantics, its last PTS can report 40ms less than wall duration.
  expect(finalDarkFrameCount).toBeGreaterThanOrEqual(24);
  const renderedDuration = await videoDurationMs(paths.rendered);
  const finalFrame = await videoFrame(paths.rendered, renderedDuration - 100);
  const finalCenter = averagePixel(finalFrame, {
    x: Math.round(finalFrame.width / 2),
    y: Math.round(finalFrame.height / 2),
  });
  expect(finalCenter.red).toBeLessThan(80);
  expect(finalCenter.green).toBeLessThan(80);
  expect(finalCenter.blue).toBeLessThan(80);
});

test("uses natural post-dialog footage without adding a synthetic hold", async ({
  page,
}, testInfo) => {
  const video = videoMode({
    finalHold: 0,
    highlight: { mode: "pointer", duration: 300 },
    trimStart: "never",
  });
  {
    await using plugged = await addPlugins({
      page,
      testInfo,
      plugins: [video],
    });
    await plugged.setContent(`
      <button id="continue">Continue</button>
      <output id="result"></output>
      <script>
        document.querySelector("#continue").addEventListener("click", () => {
          document.querySelector("#result").textContent = confirm("Continue processing?")
            ? "Processing"
            : "Stopped";
          document.body.style.background = "rgb(0, 180, 0)";
        });
      </script>
    `);
    plugged.once("dialog", (dialog) => dialog.accept());

    await plugged.locator("#continue").click();
    await plugged.getByText("Processing", { exact: true }).waitFor();
    await plugged.waitForTimeout(1_100);
  }

  const paths = video.outputPaths();
  await video.metadata();
  const finalGreenFrameCount = [...(await videoFrames(paths.rendered))]
    .reverse()
    .findIndex((frame) => {
      const center = averagePixel(frame, {
        x: Math.round(frame.width / 2),
        y: Math.round(frame.height / 2),
      });
      return center.green < center.red + 80 || center.green < center.blue + 80;
    });
  expect(finalGreenFrameCount).toBeGreaterThanOrEqual(24);
  expect(finalGreenFrameCount).toBeLessThan(40);
});

test("hides the pointer cursor after the last highlighted action", async ({ page }, testInfo) => {
  const highlightDurationMs = 700;
  const video = videoMode({ trimStart: "never",
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
      <div id="target" style="width: 180px; height: 120px; background: rgb(0, 80, 255)" onclick="this.classList.add('clicked')"></div>
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
  const highlightStart = renderedHighlightStartWithoutDeadAir(highlight, metadata.highlights);
  const clickHoldFrame = await videoFrame(
    renderedPath,
    highlightStart + highlightDurationMs - 100,
  );
  const pointerTailFrame = await videoFrame(
    renderedPath,
    highlightStart + highlightDurationMs + 100,
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
  expect(cursorPixelCount(pointerTailFrame, targetBox)).toBeGreaterThan(40);
  expect(cursorPixelCount(finalHoldFrame, targetBox)).toBeLessThan(10);
});

test("moves the pointer toward the first click after a waitFor", async ({ page }, testInfo) => {
  const highlightDurationMs = 700;
  const video = videoMode({ trimStart: "never",
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
      <div id="ready" style="visibility: hidden; position: absolute; left: 80px; top: 140px; width: 140px; height: 100px; background: rgb(0, 80, 255)"></div>
      <button id="run" style="position: absolute; left: 560px; top: 140px; width: 140px; height: 100px; border: 0; padding: 0; background: rgb(0, 190, 0)" onclick="document.body.dataset.clicked = 'true'"></button>
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

test("reveals filled text in post without changing the runtime fill", async ({
  page,
}, testInfo) => {
  const highlightDurationMs = 1000;
  const video = videoMode({
    finalHold: 0,
    highlight: { mode: "outline", duration: highlightDurationMs },
    trimStart: "never",
  });
  {
    await using plugged = await addPlugins({
      page,
      testInfo,
      plugins: [video],
    });
    await plugged.setViewportSize({ width: 800, height: 450 });
    await plugged.setContent(`
      <body style="margin: 0; width: 800px; height: 450px; background: rgb(20, 70, 180)">
        <input
          aria-label="Work email"
          style="position: absolute; box-sizing: border-box; left: 120px; top: 160px; width: 560px; height: 90px; border: 4px solid rgb(230, 120, 20); border-radius: 12px; padding: 12px 20px; background: rgb(245, 245, 245); color: rgb(20, 20, 20); caret-color: transparent; font: 42px sans-serif"
        />
        <script>
          const input = document.querySelector("input");
          const seenValues = [];
          input.addEventListener("input", () => {
            seenValues.push(input.value);
            document.body.dataset.seenValues = JSON.stringify(seenValues);
            document.body.style.background = "rgb(190, 20, 30)";
          });
        </script>
      </body>
    `);

    await plugged.getByLabel("Work email").fill("ada@example.com");

    await expect(plugged.locator("body")).toHaveAttribute(
      "data-seen-values",
      JSON.stringify(["ada@example.com"]),
    );
    await page.waitForTimeout(150);
  }

  const paths = video.outputPaths();
  const metadata = await video.metadata();
  const fillHighlight = metadata.highlights.find((highlight) => highlight.method === "fill")!;
  expect(fillHighlight).toBeDefined();

  const fillStart = renderedHighlightStartWithoutDeadAir(fillHighlight, metadata.highlights);
  const [earlyFrame, middleFrame, lateFrame] = await Promise.all(
    [100, 500, 900].map((offset) => videoFrame(paths.rendered, fillStart + offset)),
  );
  const scale = Math.min(
    lateFrame.width / fillHighlight.viewport.width,
    lateFrame.height / fillHighlight.viewport.height,
  );
  const fillBox = {
    height: Math.round(fillHighlight.rect.height * scale),
    width: Math.round(fillHighlight.rect.width * scale),
    x: Math.round(fillHighlight.rect.x * scale),
    y: Math.round(fillHighlight.rect.y * scale),
  };
  const textBox = inset(fillBox, 16);
  const darkTextPixels = [earlyFrame, middleFrame, lateFrame].map((frame) =>
    countPixels(
      frame,
      textBox,
      ({ blue, green, red }) => red < 80 && green < 80 && blue < 80,
    ),
  );

  expect(darkTextPixels[0]).toBeLessThan(darkTextPixels[1]);
  expect(darkTextPixels[1]).toBeLessThan(darkTextPixels[2]);
  expect(darkTextPixels[2]).toBeGreaterThan(300);

  const outsideField = averagePixel(lateFrame, { x: 30, y: 30 });
  expect(outsideField.blue).toBeGreaterThan(120);
  expect(outsideField.red).toBeLessThan(80);
});

test("reveals complete glyphs instead of slicing through the next character", async ({
  page,
}, testInfo) => {
  const highlightDurationMs = 1000;
  const video = videoMode({
    captions: "explicit",
    finalHold: 0,
    highlight: { mode: "outline", duration: highlightDurationMs },
    trimStart: "never",
  });
  {
    await using plugged = await addPlugins({
      page,
      testInfo,
      plugins: [video],
    });
    await plugged.setViewportSize({ width: 800, height: 450 });
    await plugged.setContent(`
      <input
        aria-label="Code"
        style="position: absolute; box-sizing: border-box; left: 120px; top: 160px; width: 560px; height: 90px; border: 0; padding: 12px 20px; background: white; color: black; caret-color: transparent; font: 54px monospace"
      />
    `);

    await plugged.videoMode.caption("Reveal complete glyphs", async () => {
      await plugged.getByLabel("Code").fill("A @ B");
      await expect(plugged.getByLabel("Code")).toHaveValue("A @ B");
      await page.waitForTimeout(150);
    });
  }

  const paths = video.outputPaths();
  const metadata = await video.metadata();
  const fillHighlight = metadata.highlights.find((highlight) => highlight.method === "fill")!;
  expect(fillHighlight).toBeDefined();

  const fillStart = renderedHighlightStartWithoutDeadAir(fillHighlight, metadata.highlights);
  const frames = await videoFrames(paths.rendered);
  const finalFrame = await videoFrame(paths.rendered, fillStart + 900);
  const scale = Math.min(
    finalFrame.width / fillHighlight.viewport.width,
    finalFrame.height / fillHighlight.viewport.height,
  );
  const textBox = {
    height: Math.round(66 * scale),
    width: Math.round(500 * scale),
    x: Math.round((fillHighlight.rect.x + 20) * scale),
    y: Math.round((fillHighlight.rect.y + 12) * scale),
  };
  const glyphs = darkColumnRuns(finalFrame, textBox);
  expect(glyphs).toHaveLength(3);
  const atGlyph = glyphs[1];
  const finalAtPixels = countPixels(
    finalFrame,
    atGlyph,
    ({ blue, green, red }) => red < 80 && green < 80 && blue < 80,
  );
  const fillFrames = frames.slice(
    Math.floor(fillStart / 40),
    Math.ceil((fillStart + highlightDurationMs) / 40),
  );
  const partialAtFrames = fillFrames
    .map((frame, index) => ({
      darkPixels: countPixels(
        frame,
        atGlyph,
        ({ blue, green, red }) => red < 80 && green < 80 && blue < 80,
      ),
      index,
    }))
    .filter(
      ({ darkPixels }) =>
        darkPixels > 5 && darkPixels < finalAtPixels * 0.85,
    );

  expect(partialAtFrames).toEqual([]);
});

test("moves to the field and switches to the text cursor before revealing", async ({
  page,
}, testInfo) => {
  const highlightDurationMs = 1200;
  const video = videoMode({
    captions: "explicit",
    finalHold: 0,
    highlight: { mode: "pointer", duration: highlightDurationMs },
    trimStart: "never",
  });
  {
    await using plugged = await addPlugins({
      page,
      testInfo,
      plugins: [video],
    });
    await plugged.setViewportSize({ width: 800, height: 450 });
    await plugged.setContent(`
      <input
        aria-label="Name"
        style="position: absolute; box-sizing: border-box; left: 480px; top: 160px; width: 280px; height: 90px; border: 0; padding: 12px 20px; background: rgb(0, 80, 255); color: rgb(230, 0, 0); caret-color: transparent; font: 54px monospace"
      />
    `);

    await plugged.videoMode.caption("Move, switch cursor, then reveal", async () => {
      await plugged.getByLabel("Name").fill("Ada");
      await expect(plugged.getByLabel("Name")).toHaveValue("Ada");
      await page.waitForTimeout(150);
    });
  }

  const paths = video.outputPaths();
  const metadata = await video.metadata();
  const fillHighlight = metadata.highlights.find((highlight) => highlight.method === "fill")!;
  expect(fillHighlight).toBeDefined();

  const fillStart = renderedHighlightStartWithoutDeadAir(fillHighlight, metadata.highlights);
  const frames = await videoFrames(paths.rendered);
  const fillFrames = frames.slice(
    Math.floor(fillStart / 40),
    Math.ceil((fillStart + highlightDurationMs) / 40),
  );
  const scale = Math.min(
    frames[0].width / fillHighlight.viewport.width,
    frames[0].height / fillHighlight.viewport.height,
  );
  const fillBox = {
    height: Math.round(fillHighlight.rect.height * scale),
    width: Math.round(fillHighlight.rect.width * scale),
    x: Math.round(fillHighlight.rect.x * scale),
    y: Math.round(fillHighlight.rect.y * scale),
  };
  const textBox = {
    height: Math.round(66 * scale),
    width: Math.round(120 * scale),
    x: Math.round((fillHighlight.rect.x + 20) * scale),
    y: Math.round((fillHighlight.rect.y + 12) * scale),
  };
  const textCursorFrame = fillFrames.findIndex(
    (frame) =>
      textCursorPixelCount(frame, fillBox) > 35 &&
      pointerTailPixelCount(frame, fillBox) < 10,
  );
  const firstRevealFrame = fillFrames.findIndex(
    (frame) =>
      countPixels(
        frame,
        textBox,
        ({ blue, green, red }) => red > 150 && green < 80 && blue < 80,
      ) > 30,
  );

  expect(textCursorFrame).toBeGreaterThan(0);
  expect(firstRevealFrame).toBeGreaterThan(textCursorFrame);
});

test("preserves gradient field pixels while revealing the filled text", async ({
  page,
}, testInfo) => {
  const highlightDurationMs = 1000;
  const video = videoMode({
    captions: "explicit",
    finalHold: 0,
    highlight: { mode: "outline", duration: highlightDurationMs },
    trimStart: "never",
  });
  {
    await using plugged = await addPlugins({
      page,
      testInfo,
      plugins: [video],
    });
    await plugged.setViewportSize({ width: 800, height: 450 });
    await plugged.setContent(`
      <input
        aria-label="Gradient"
        style="position: absolute; box-sizing: border-box; left: 120px; top: 160px; width: 560px; height: 90px; border: 0; padding: 12px 20px; background: linear-gradient(90deg, rgb(240, 60, 40), rgb(30, 80, 230)); color: black; caret-color: transparent; font: 54px monospace"
      />
    `);

    await plugged.videoMode.caption("Preserve gradient pixels", async () => {
      await plugged.getByLabel("Gradient").fill("Ada");
      await expect(plugged.getByLabel("Gradient")).toHaveValue("Ada");
      await page.waitForTimeout(150);
    });
  }

  const paths = video.outputPaths();
  const metadata = await video.metadata();
  const fillHighlight = metadata.highlights.find((highlight) => highlight.method === "fill")!;
  expect(fillHighlight).toBeDefined();

  const fillStart = renderedHighlightStartWithoutDeadAir(fillHighlight, metadata.highlights);
  const [earlyFrame, lateFrame] = await Promise.all([
    videoFrame(paths.rendered, fillStart + 100),
    videoFrame(paths.rendered, fillStart + 900),
  ]);
  const scale = Math.min(
    earlyFrame.width / fillHighlight.viewport.width,
    earlyFrame.height / fillHighlight.viewport.height,
  );
  const leftGradient = averagePixel(earlyFrame, {
    x: Math.round((fillHighlight.rect.x + 60) * scale),
    y: Math.round((fillHighlight.rect.y + 70) * scale),
  });
  const rightGradient = averagePixel(earlyFrame, {
    x: Math.round((fillHighlight.rect.x + fillHighlight.rect.width - 60) * scale),
    y: Math.round((fillHighlight.rect.y + 70) * scale),
  });
  const textBox = {
    height: Math.round(66 * scale),
    width: Math.round(140 * scale),
    x: Math.round((fillHighlight.rect.x + 20) * scale),
    y: Math.round((fillHighlight.rect.y + 12) * scale),
  };

  expect(leftGradient.red).toBeGreaterThan(leftGradient.blue + 80);
  expect(rightGradient.blue).toBeGreaterThan(rightGradient.red + 80);
  expect(
    countPixels(
      lateFrame,
      textBox,
      ({ blue, green, red }) => red < 80 && green < 80 && blue < 80,
    ),
  ).toBeGreaterThan(300);
});

test("reveals a stable single-line textarea fill", async ({ page }, testInfo) => {
  const highlightDurationMs = 1000;
  const video = videoMode({
    captions: "explicit",
    finalHold: 0,
    highlight: { mode: "outline", duration: highlightDurationMs },
    trimStart: "never",
  });
  {
    await using plugged = await addPlugins({
      page,
      testInfo,
      plugins: [video],
    });
    await plugged.setViewportSize({ width: 800, height: 450 });
    await plugged.setContent(`
      <textarea
        aria-label="Notes"
        style="position: absolute; box-sizing: border-box; left: 120px; top: 130px; width: 560px; height: 150px; border: 0; padding: 18px 20px; overflow: hidden; resize: none; background: white; color: black; caret-color: transparent; font: 48px monospace"
      ></textarea>
      <script>
        const notes = document.querySelector("textarea");
        const seenValues = [];
        notes.addEventListener("input", () => {
          seenValues.push(notes.value);
          document.body.dataset.seenValues = JSON.stringify(seenValues);
        });
      </script>
    `);

    await plugged.videoMode.caption("Reveal a stable textarea fill", async () => {
      await plugged.getByLabel("Notes").fill("Ada notes");
      await expect(plugged.getByLabel("Notes")).toHaveValue("Ada notes");
      await expect(plugged.locator("body")).toHaveAttribute(
        "data-seen-values",
        JSON.stringify(["Ada notes"]),
      );
      await page.waitForTimeout(150);
    });
  }

  const paths = video.outputPaths();
  const metadata = await video.metadata();
  const fillHighlight = metadata.highlights.find((highlight) => highlight.method === "fill")!;
  expect(fillHighlight.fillReveal).toBeDefined();

  const fillStart = renderedHighlightStartWithoutDeadAir(fillHighlight, metadata.highlights);
  const [earlyFrame, middleFrame, lateFrame] = await Promise.all(
    [100, 500, 900].map((offset) => videoFrame(paths.rendered, fillStart + offset)),
  );
  const scale = Math.min(
    lateFrame.width / fillHighlight.viewport.width,
    lateFrame.height / fillHighlight.viewport.height,
  );
  const textBox = {
    height: Math.round(62 * scale),
    width: Math.round(500 * scale),
    x: Math.round((fillHighlight.rect.x + 20) * scale),
    y: Math.round((fillHighlight.rect.y + 18) * scale),
  };
  const darkTextPixels = [earlyFrame, middleFrame, lateFrame].map((frame) =>
    countPixels(
      frame,
      textBox,
      ({ blue, green, red }) => red < 80 && green < 80 && blue < 80,
    ),
  );

  expect(darkTextPixels[0]).toBeLessThan(darkTextPixels[1]);
  expect(darkTextPixels[1]).toBeLessThan(darkTextPixels[2]);
  expect(darkTextPixels[2]).toBeGreaterThan(300);
});

test("falls back to a normal fill for a scrolling textarea", async ({
  page,
}, testInfo) => {
  const video = videoMode({
    captions: "explicit",
    finalHold: 250,
    highlight: { mode: "outline", duration: 800 },
    trimStart: "never",
  });
  {
    await using plugged = await addPlugins({
      page,
      testInfo,
      plugins: [video],
    });
    await plugged.setViewportSize({ width: 800, height: 450 });
    await plugged.setContent(`
      <textarea
        aria-label="Log"
        style="position: absolute; box-sizing: border-box; left: 220px; top: 120px; width: 360px; height: 150px; padding: 14px; resize: none; background: white; color: black; font: 30px monospace"
      ></textarea>
    `);

    await plugged.videoMode.caption("Scrolling textarea: use a normal fill", async () => {
      await plugged
        .getByLabel("Log")
        .fill("first line\nsecond line\nthird line\nfourth line\nfifth line");
      await expect(plugged.getByLabel("Log")).toHaveValue(
        "first line\nsecond line\nthird line\nfourth line\nfifth line",
      );
      await expect
        .poll(() =>
          plugged
            .getByLabel("Log")
            .evaluate((textarea) => textarea.scrollHeight > textarea.clientHeight),
        )
        .toBe(true);
      await page.waitForTimeout(150);
    });
  }

  const metadata = await video.metadata();
  const fillHighlight = metadata.highlights.find((highlight) => highlight.method === "fill")!;
  expect(fillHighlight).toBeDefined();
  expect(fillHighlight).not.toHaveProperty("fillReveal");
  const frame = await videoFrame(
    video.outputPaths().rendered,
    renderedHighlightStartWithoutDeadAir(fillHighlight, metadata.highlights) + 600,
  );
  const scale = Math.min(
    frame.width / fillHighlight.viewport.width,
    frame.height / fillHighlight.viewport.height,
  );
  expect(
    countPixels(
      frame,
      inset(
        {
          height: Math.round(fillHighlight.rect.height * scale),
          width: Math.round(fillHighlight.rect.width * scale),
          x: Math.round(fillHighlight.rect.x * scale),
          y: Math.round(fillHighlight.rect.y * scale),
        },
        10,
      ),
      ({ blue, green, red }) => red < 80 && green < 80 && blue < 80,
    ),
  ).toBeGreaterThan(200);
});

test("falls back to a normal fill when a textarea expands", async ({
  page,
}, testInfo) => {
  const video = videoMode({
    captions: "explicit",
    finalHold: 250,
    highlight: { mode: "outline", duration: 800 },
    trimStart: "never",
  });
  let initialHeight = 0;
  {
    await using plugged = await addPlugins({
      page,
      testInfo,
      plugins: [video],
    });
    await plugged.setViewportSize({ width: 800, height: 450 });
    await plugged.setContent(`
      <textarea
        aria-label="Summary"
        style="position: absolute; box-sizing: border-box; left: 240px; top: 100px; width: 320px; height: 70px; padding: 12px; overflow: hidden; resize: none; background: white; color: black; font: 30px sans-serif"
      ></textarea>
      <script>
        const summary = document.querySelector("textarea");
        summary.addEventListener("input", () => {
          summary.style.height = "auto";
          summary.style.height = summary.scrollHeight + "px";
        });
      </script>
    `);
    initialHeight = (await plugged.getByLabel("Summary").boundingBox())!.height;

    await plugged.videoMode.caption("Expanding textarea: use a normal fill", async () => {
      await plugged
        .getByLabel("Summary")
        .fill("This textarea grows to fit a longer summary without scrolling.");
      await expect(plugged.getByLabel("Summary")).toHaveValue(
        "This textarea grows to fit a longer summary without scrolling.",
      );
      await expect
        .poll(async () => (await plugged.getByLabel("Summary").boundingBox())!.height)
        .toBeGreaterThan(initialHeight);
      await page.waitForTimeout(150);
    });
  }

  const metadata = await video.metadata();
  const fillHighlight = metadata.highlights.find((highlight) => highlight.method === "fill")!;
  expect(fillHighlight).toBeDefined();
  expect(fillHighlight).not.toHaveProperty("fillReveal");
  expect(fillHighlight.rect.height).toBeGreaterThan(initialHeight);
  const frame = await videoFrame(
    video.outputPaths().rendered,
    renderedHighlightStartWithoutDeadAir(fillHighlight, metadata.highlights) + 600,
  );
  const scale = Math.min(
    frame.width / fillHighlight.viewport.width,
    frame.height / fillHighlight.viewport.height,
  );
  expect(
    countPixels(
      frame,
      inset(
        {
          height: Math.round(fillHighlight.rect.height * scale),
          width: Math.round(fillHighlight.rect.width * scale),
          x: Math.round(fillHighlight.rect.x * scale),
          y: Math.round(fillHighlight.rect.y * scale),
        },
        10,
      ),
      ({ blue, green, red }) => red < 80 && green < 80 && blue < 80,
    ),
  ).toBeGreaterThan(200);
});

test("uses a normal pointer tail after text cursor holds", async ({
  page,
}, testInfo) => {
  const highlightDurationMs = 1000;
  const video = videoMode({ trimStart: "never",
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
      <input id="name" aria-label="name" style="border: 0; box-sizing: border-box; caret-color: transparent; font: 32px sans-serif; outline: 0; padding: 0; position: absolute; background: rgb(0, 80, 255); color: rgb(0, 80, 255); height: 120px; left: 560px; top: 80px; width: 160px" />
      <textarea id="notes" aria-label="notes" style="border: 0; box-sizing: border-box; caret-color: transparent; font: 32px sans-serif; outline: 0; padding: 0; position: absolute; resize: none; background: rgb(0, 190, 0); color: rgb(0, 190, 0); height: 120px; left: 80px; top: 360px; width: 180px"></textarea>
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
  const fillTextFrame = await videoFrame(renderedPath, fillStart + 700);
  const fillPointerTailFrame = await videoFrame(renderedPath, fillStart + highlightDurationMs - 100);
  const typeTextFrame = await videoFrame(renderedPath, typeStart + 700);
  const typePointerTailFrame = await videoFrame(renderedPath, typeStart + highlightDurationMs - 100);
  const scale = Math.min(
    fillTextFrame.width / fillHighlight.viewport.width,
    fillTextFrame.height / fillHighlight.viewport.height,
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

  expect(textCursorPixelCount(fillTextFrame, fillBox)).toBeGreaterThan(35);
  expect(pointerTailPixelCount(fillTextFrame, fillBox)).toBeLessThan(10);
  expect(textCursorTopCapPixelCount(fillPointerTailFrame, fillBox)).toBeLessThan(3);
  expect(pointerTailPixelCount(fillPointerTailFrame, fillBox)).toBeGreaterThan(20);
  expect(textCursorPixelCount(typeTextFrame, typeBox)).toBeGreaterThan(35);
  expect(pointerTailPixelCount(typeTextFrame, typeBox)).toBeLessThan(10);
  expect(textCursorTopCapPixelCount(typePointerTailFrame, typeBox)).toBeLessThan(3);
  expect(pointerTailPixelCount(typePointerTailFrame, typeBox)).toBeGreaterThan(20);
});

test("does not replay action frames when a hold overlaps the next highlight", async ({
  page,
}, testInfo) => {
  const highlightDurationMs = 1000;
  const video = videoMode({ trimStart: "never",
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
      <body style="margin: 0; width: 800px; height: 600px; background: rgb(0, 180, 0)">
      <input id="name" aria-label="name" />
      <button id="run">run</button>
      <script>
        document.body.dataset.phase = "stable";
        document.querySelector("#name").addEventListener("input", () => {
          document.body.dataset.phase = "transient";
          document.body.dataset.transientSeen = "true";
          document.body.style.background = "rgb(220, 0, 0)";
          setTimeout(() => {
            document.body.dataset.phase = "stable";
            document.body.style.background = "rgb(0, 180, 0)";
          }, 260);
        });
        document.querySelector("#run").addEventListener("click", () => {
          document.body.dataset.clicked = "true";
        });
      </script>
      </body>
    `);

    await plugged.locator("#name").fill("Ada");
    await expect(plugged.locator("body")).toHaveAttribute("data-transient-seen", "true");
    await expect(plugged.locator("body")).toHaveAttribute("data-phase", "stable");
    await plugged.locator("#run").click();
    await expect(plugged.locator("body")).toHaveAttribute("data-clicked", "true");
    await plugged.waitForTimeout(100);
  }

  const paths = video.outputPaths();
  const metadata = await video.metadata();
  const fillHighlight = metadata.highlights.find((highlight) => highlight.method === "fill")!;
  const clickHighlight = metadata.highlights.find((highlight) => highlight.method === "click")!;
  expect(fillHighlight).toBeDefined();
  expect(clickHighlight).toBeDefined();
  expect(fillHighlight.end).toBeGreaterThan(clickHighlight.start);

  const fillStart = renderedHighlightStartWithoutDeadAir(fillHighlight, metadata.highlights);
  const afterFillHoldFrame = await videoFrame(
    paths.rendered,
    fillStart + highlightDurationMs + 80,
  );
  const center = averagePixel(afterFillHoldFrame, {
    x: Math.round(afterFillHoldFrame.width / 2),
    y: Math.round(afterFillHoldFrame.height / 2),
  });

  expect(center).toMatchObject({
    blue: expect.any(Number),
    green: expect.any(Number),
    red: expect.any(Number),
  });
  expect(center.green).toBeGreaterThan(center.red + 80);
});

test("does not linger on the unhighlighted post-wait state before a following highlight", async ({
  page,
}, testInfo) => {
  const video = videoMode({ trimStart: "never",
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
      <button id="start" style="position: absolute; left: 80px; top: 180px; width: 180px; height: 80px">start</button>
      <button id="next" disabled style="position: absolute; left: 340px; top: 180px; width: 180px; height: 80px; background: rgb(70, 70, 70)">next</button>
      <div data-spinner="true" hidden>Loading</div>
      <div id="done"></div>
      <script>
        const spinner = document.querySelector('[data-spinner="true"]');
        const next = document.querySelector('#next');
        document.querySelector('#start').addEventListener('click', () => {
          next.disabled = true;
          next.style.background = 'rgb(70, 70, 70)';
          spinner.hidden = false;
          setTimeout(() => {
            spinner.hidden = true;
            next.disabled = false;
            next.style.background = 'rgb(0, 190, 0)';
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
  const ordered = [...highlights].sort((a, b) => a.start - b.start);
  let renderedStart = 0;
  let previous: { end: number; start: number } | undefined;

  for (const candidate of ordered) {
    if (!previous) {
      renderedStart = candidate.start;
    } else if (previous.end > candidate.start) {
      // the previous highlight's hold overlaps this one's source start, so the
      // renderer starts this hold the moment the previous hold ends and drops
      // the source gap between the actions (videoPieces overlap rule)
      renderedStart += previous.end - previous.start;
    } else {
      renderedStart += previous.end - previous.start + candidate.start - previous.start;
    }

    if (candidate === highlight) {
      return renderedStart;
    }

    previous = candidate;
  }

  throw new Error("highlight not present in highlights");
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

const darkColumnRuns = (
  frame: VideoFrame,
  rect: { height: number; width: number; x: number; y: number },
) => {
  const runs: { height: number; width: number; x: number; y: number }[] = [];
  let start: number | undefined;

  for (let x = rect.x; x < rect.x + rect.width; x += 1) {
    const hasDarkPixel =
      countPixels(
        frame,
        { height: rect.height, width: 1, x, y: rect.y },
        ({ blue, green, red }) => red < 80 && green < 80 && blue < 80,
      ) > 0;

    if (hasDarkPixel && start === undefined) {
      start = x;
    }
    if (!hasDarkPixel && start !== undefined) {
      runs.push({
        height: rect.height,
        width: x - start,
        x: start,
        y: rect.y,
      });
      start = undefined;
    }
  }

  if (start !== undefined) {
    runs.push({
      height: rect.height,
      width: rect.x + rect.width - start,
      x: start,
      y: rect.y,
    });
  }

  return runs;
};

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

const textCursorTopCapPixelCount = (
  frame: VideoFrame,
  rect: { height: number; width: number; x: number; y: number },
) => {
  const center = centerOf(rect);

  return blackOrWhitePixelCount(frame, {
    height: 6,
    width: 20,
    x: center.x - 10,
    y: center.y - 14,
  });
};

const pointerTailPixelCount = (
  frame: VideoFrame,
  rect: { height: number; width: number; x: number; y: number },
) => {
  const center = centerOf(rect);

  return blackOrWhitePixelCount(frame, {
    height: 36,
    width: 6,
    x: center.x + 8,
    y: center.y - 18,
  });
};

const blackOrWhitePixelCount = (
  frame: VideoFrame,
  rect: { height: number; width: number; x: number; y: number },
) => {
  return countPixels(frame, rect, ({ blue, green, red }) => {
    const nearlyWhite = red > 230 && green > 230 && blue > 230;
    const nearlyBlack = red < 35 && green < 35 && blue < 35;
    return nearlyWhite || nearlyBlack;
  });
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
