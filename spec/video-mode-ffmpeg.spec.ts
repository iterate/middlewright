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

test("renders a multi-navigation release flow without changing the live page", async ({
  page,
}, testInfo) => {
  const urls = [
    "https://dashboard.middlewright.test/runs",
    "https://dashboard.middlewright.test/releases/2026.7",
    "https://dashboard.middlewright.test/reports/128?browser=chromium",
  ];
  await page.route("https://dashboard.middlewright.test/**", async (route) => {
    await route.fulfill({
      body: releaseDemoPage(new URL(route.request().url()).pathname),
      contentType: "text/html",
    });
  });
  const video = videoMode({
    addressBar: { holdMs: 800 },
    captions: "explicit",
    finalHold: 800,
    highlight: { mode: "pointer", duration: 500 },
    trimStart: "never",
  });
  {
    await using plugged = await addPlugins({ page, testInfo, plugins: [video] });
    await plugged.setViewportSize({ width: 960, height: 540 });

    await plugged.goto(urls[0]);
    await plugged.getByRole("textbox", { name: "Search releases" }).fill("2026.7");
    await plugged.getByRole("button", { name: "Ready only" }).click();
    await expect(plugged.getByText("Release 2026.8-beta")).toHaveCount(0);
    await plugged.waitForTimeout(250);

    await plugged.goto(urls[1]);
    await plugged.getByRole("button", { name: "Chromium" }).click();
    await expect(plugged.getByText("48 Chromium specs passed")).toBeVisible();
    await plugged.waitForTimeout(250);

    await plugged.goto(urls[2]);
    await plugged.getByRole("button", { name: "Show slowest specs" }).click();
    await expect(plugged.getByRole("table")).toBeVisible();
    await plugged.waitForTimeout(400);
    await expect(
      plugged.locator("[data-middlewright-video-mode-address-bar]"),
    ).toHaveCount(0);
  }

  const paths = video.outputPaths();
  const metadata = await video.metadata();
  expect(metadata).toMatchObject({
    addressBars: urls.map((url) => ({
      end: expect.any(Number),
      start: expect.any(Number),
      url,
    })),
    outputs: {
      raw: "video-raw.webm",
      rendered: "video-rendered.webm",
    },
  });

  const [rawFrames, renderedFrames] = await Promise.all([
    videoFrames(paths.raw, 5),
    videoFrames(paths.rendered, 5),
  ]);
  expect(rawFrames.filter(hasAddressBar).length).toBe(0);
  expect(renderedFrames.filter(hasAddressBar).length).toBeGreaterThan(8);
});

test("reveals a goto destination progressively in the rendered address bar", async ({
  page,
}, testInfo) => {
  const url = "https://dashboard.middlewright.test/releases/2026.8?view=review";
  await page.route(url, async (route) => {
    await route.fulfill({
      body: '<main style="position: fixed; inset: 0; background: rgb(70, 30, 120)"></main>',
      contentType: "text/html",
    });
  });
  const video = videoMode({
    addressBar: { holdMs: 1200 },
    finalHold: 0,
    highlight: false,
    trimStart: "never",
  });
  {
    await using plugged = await addPlugins({ page, testInfo, plugins: [video] });
    await plugged.setViewportSize({ width: 800, height: 450 });

    await plugged.goto(url);
  }

  const frames = (await videoFrames(video.outputPaths().rendered, 25)).filter(hasAddressBar);
  expect(frames.length).toBeGreaterThan(20);
  const sampledFrames = [frames[2], frames[Math.floor(frames.length / 2)], frames.at(-3)!];
  const lightTextPixels = sampledFrames.map((frame) =>
    countPixels(
      frame,
      { height: 44, width: frame.width - 40, x: 20, y: 7 },
      ({ blue, green, red }) => red > 210 && green > 210 && blue > 210,
    ),
  );

  expect(lightTextPixels[0]).toBeLessThan(lightTextPixels[1]);
  expect(lightTextPixels[1]).toBeLessThan(lightTextPixels[2]);
  expect(lightTextPixels[2]).toBeGreaterThan(250);
});

test("keeps a long goto destination in a compact address field", async ({
  page,
}, testInfo) => {
  const url = `https://dashboard.middlewright.test/releases/${"a-very-long-path-segment/".repeat(12)}report?browser=chromium&view=review`;
  await page.route("https://dashboard.middlewright.test/**", async (route) => {
    await route.fulfill({
      body: '<main style="position: fixed; inset: 0; background: rgb(70, 30, 120)"></main>',
      contentType: "text/html",
    });
  });
  const video = videoMode({
    addressBar: { holdMs: 1200 },
    finalHold: 0,
    highlight: false,
    trimStart: "never",
  });
  {
    await using plugged = await addPlugins({ page, testInfo, plugins: [video] });
    await plugged.setViewportSize({ width: 960, height: 540 });

    await plugged.goto(url);
  }

  const frames = (await videoFrames(video.outputPaths().rendered, 25)).filter(hasAddressBar);
  const finalAddressFrame = frames.at(-2)!;
  const addressBarHeight = Math.max(58, Math.round(finalAddressFrame.height * 0.12));
  const pillX = Math.max(12, Math.round(finalAddressFrame.width * 0.017));
  const pillY = Math.max(9, Math.round(addressBarHeight * 0.18));
  const pillHeight = addressBarHeight - pillY * 2;
  const textLeft = pillX + Math.round(pillHeight * 0.42);
  const textRight = finalAddressFrame.width - pillX - Math.round(pillHeight * 0.35);
  const textBounds = pixelBoundingBox(
    finalAddressFrame,
    { height: addressBarHeight, width: finalAddressFrame.width, x: 0, y: 0 },
    ({ blue, green, red }) => red > 210 && green > 210 && blue > 210,
  )!;

  expect(textBounds).toMatchObject({
    height: expect.any(Number),
    width: expect.any(Number),
    x: expect.any(Number),
    y: expect.any(Number),
  });
  expect(textBounds.height).toBeLessThanOrEqual(12);
  expect(textBounds.x).toBeGreaterThanOrEqual(textLeft);
  expect(textBounds.x + textBounds.width).toBeLessThanOrEqual(textRight + 1);
});

test("renders navigation before clicking a control at the top edge", async ({
  page,
}, testInfo) => {
  const url = "https://dashboard.middlewright.test/runs/128";
  await page.route(url, async (route) => {
    await route.fulfill({
      body: topEdgeActionPage(),
      contentType: "text/html",
    });
  });
  const video = videoMode({
    addressBar: { holdMs: 1200 },
    captions: "explicit",
    finalHold: 800,
    highlight: { mode: "outline", duration: 900 },
    trimStart: "never",
  });
  {
    await using plugged = await addPlugins({ page, testInfo, plugins: [video] });
    await plugged.setViewportSize({ width: 960, height: 540 });

    await plugged.goto(url);
    await plugged.getByRole("button", { name: "Approve run" }).click();
    await expect(plugged.getByRole("status")).toHaveText("Run approved");
    await plugged.waitForTimeout(400);
  }

  const paths = video.outputPaths();
  const metadata = await video.metadata();
  const [topEdgeHighlight] = metadata.highlights;
  expect(topEdgeHighlight).toMatchObject({
    method: "click",
    rect: {
      y: expect.any(Number),
    },
  });
  expect(topEdgeHighlight.rect.y + topEdgeHighlight.rect.height).toBeLessThan(65);

  const [rawFrames, renderedFrames] = await Promise.all([
    videoFrames(paths.raw, 10),
    videoFrames(paths.rendered, 10),
  ]);
  const scale = Math.min(
    renderedFrames[0].width / topEdgeHighlight.viewport.width,
    renderedFrames[0].height / topEdgeHighlight.viewport.height,
  );
  const topEdgeBox = {
    height: Math.round(topEdgeHighlight.rect.height * scale),
    width: Math.round(topEdgeHighlight.rect.width * scale),
    x: Math.round(topEdgeHighlight.rect.x * scale),
    y: Math.round(topEdgeHighlight.rect.y * scale),
  };
  const addressBarFrames = renderedFrames.filter(hasAddressBar);
  const highlightedFrames = renderedFrames.filter((frame) => hasYellow(frame, topEdgeBox));

  expect(rawFrames.filter(hasAddressBar).length).toBe(0);
  expect(addressBarFrames.length).toBeGreaterThan(8);
  expect(highlightedFrames.length).toBeGreaterThan(5);
  expect(
    renderedFrames.filter(
      (frame) => hasAddressBar(frame) && hasYellow(frame, topEdgeBox),
    ).length,
  ).toBe(0);
});

test("keeps a navigation caption visible throughout its address-bar hold", async ({
  page,
}, testInfo) => {
  const url = "https://dashboard.middlewright.test/runs/128";
  await page.route(url, async (route) => {
    await route.fulfill({
      body: '<main style="position: fixed; inset: 0; background: rgb(30, 40, 80)"></main>',
      contentType: "text/html",
    });
  });
  const video = videoMode({
    addressBar: { holdMs: 1200 },
    finalHold: 0,
    highlight: false,
    trimStart: "never",
  });
  {
    await using plugged = await addPlugins({ page, testInfo, plugins: [video] });
    await plugged.setViewportSize({ width: 800, height: 450 });

    await test.step("Open run 128", async () => {
      await plugged.goto(url);
    });
  }

  const paths = video.outputPaths();
  const frames = await videoFrames(paths.rendered, 10);
  const addressBarFrames = frames.filter(hasAddressBar);

  expect(addressBarFrames.length).toBeGreaterThan(8);
  expect(addressBarFrames.filter(hasWhiteCaption)).toHaveLength(addressBarFrames.length);
});

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
    "waitFor",
    "click",
    "click",
    "waitFor",
    "click",
    "waitFor",
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

test("speeds dead air to the default threshold instead of cutting through it", async ({
  page,
}, testInfo) => {
  const deadAirThresholdMs = 300;
  const video = videoMode({
    trimStart: "never",
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
  const completedStateBeforeHold = (await videoFrames(renderedPath, 25))
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

  const renderedFrames = await videoFrames(paths.rendered, 25);
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

test("reveals accepted prompt text progressively in the rendered dialog", async ({
  page,
}, testInfo) => {
  const highlightDurationMs = 1000;
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
        <button id="sign-in" style="position: absolute; left: 370px; top: 460px">Sign in</button>
        <output id="result"></output>
        <script>
          document.querySelector("#sign-in").addEventListener("click", () => {
            document.querySelector("#result").textContent = prompt("Enter the password") || "";
          });
        </script>
      </body>
    `);
    plugged.once("dialog", (dialog) => dialog.accept("correct 👩🏽‍💻 battery staple"));

    await plugged.locator("#sign-in").click();

    await expect(plugged.locator("#result")).toHaveText("correct 👩🏽‍💻 battery staple");
  }

  const paths = video.outputPaths();
  const metadata = await video.metadata();
  const promptFill = metadata.highlights.find(
    (highlight) => highlight.method === "fill" && highlight.dialog?.type === "prompt",
  )!;
  const promptClick = metadata.highlights.find(
    (highlight) => highlight.method === "click" && highlight.dialog?.type === "prompt",
  )!;
  expect(promptFill).toBeDefined();
  expect(promptClick).toBeDefined();

  const renderedFrames = await videoFrames(paths.rendered, 25);
  const scale = Math.min(
    renderedFrames[0].width / promptFill.viewport.width,
    renderedFrames[0].height / promptFill.viewport.height,
  );
  const inputBox = {
    height: Math.round(promptFill.rect.height * scale),
    width: Math.round(promptFill.rect.width * scale),
    x: Math.round(promptFill.rect.x * scale),
    y: Math.round(promptFill.rect.y * scale),
  };
  const textBox = {
    height: inputBox.height - 12,
    width: Math.round(inputBox.width * 0.4),
    x: inputBox.x + 8,
    y: inputBox.y + 6,
  };
  const buttonScale = Math.min(
    renderedFrames[0].width / promptClick.viewport.width,
    renderedFrames[0].height / promptClick.viewport.height,
  );
  const okButtonBox = {
    height: Math.round(promptClick.rect.height * buttonScale),
    width: Math.round(promptClick.rect.width * buttonScale),
    x: Math.round(promptClick.rect.x * buttonScale),
    y: Math.round(promptClick.rect.y * buttonScale),
  };
  const dialogFrames = renderedFrames.filter(
    (frame) =>
      countPixels(
        frame,
        inset(inputBox, 3),
        ({ blue, green, red }) => red > 220 && green > 220 && blue > 220,
      ) > inputBox.width * inputBox.height * 0.5,
  );
  const darkTextPixels = dialogFrames.map((frame) =>
    countPixels(
      frame,
      textBox,
      ({ blue, green, red }) => red < 80 && green < 80 && blue < 80,
    ),
  );
  const completePixelCount = Math.max(...darkTextPixels);
  const blankFrame = darkTextPixels.findIndex((count) => count < 20);
  const partialFrame = darkTextPixels.findIndex(
    (count) => count > 20 && count < completePixelCount * 0.8,
  );
  const completeFrame = darkTextPixels.findIndex(
    (count) => count >= completePixelCount * 0.95,
  );
  const selectedButtonPixels = dialogFrames.map((frame) =>
    countPixels(
      frame,
      inset(okButtonBox, 6),
      ({ blue, green, red }) => blue > 150 && blue > red * 1.4 && blue > green * 1.1,
    ),
  );
  const firstSelectedFrame = selectedButtonPixels.findIndex((count) => count > 100);

  expect(dialogFrames.length).toBeGreaterThanOrEqual(Math.round((highlightDurationMs * 2) / 40));
  expect(completePixelCount).toBeGreaterThan(50);
  expect(blankFrame).toBeGreaterThanOrEqual(0);
  expect(partialFrame).toBeGreaterThan(blankFrame);
  expect(completeFrame).toBeGreaterThan(partialFrame);
  expect(firstSelectedFrame).toBeGreaterThan(completeFrame);
  expect(selectedButtonPixels.slice(firstSelectedFrame).every((count) => count > 100)).toBe(true);

  const rawFrames = await videoFrames(paths.raw, 25);
  const center = {
    height: Math.round(rawFrames[0].height * 0.5),
    width: Math.round(rawFrames[0].width * 0.5),
    x: Math.round(rawFrames[0].width * 0.125),
    y: Math.round(rawFrames[0].height * 0.25),
  };
  const mostWhiteRawPixels = Math.max(
    ...rawFrames.map((frame) =>
      countPixels(
        frame,
        center,
        ({ blue, green, red }) => red > 220 && green > 220 && blue > 220,
      ),
    ),
  );
  expect(mostWhiteRawPixels).toBeLessThan(5_000);
});

test("clears a Unicode prompt default before selecting an explicit empty response", async ({
  page,
}, testInfo) => {
  const highlightDurationMs = 700;
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
        <button id="rename">Rename</button>
        <output id="result"></output>
        <script>
          document.querySelector("#rename").addEventListener("click", () => {
            document.querySelector("#result").textContent = JSON.stringify(prompt(
              "Choose a replacement name for the release note before publishing it to the entire engineering team.",
              "draft-👩🏽‍💻.md",
            ));
          });
        </script>
      </body>
    `);
    plugged.once("dialog", (dialog) => dialog.accept(""));

    await plugged.locator("#rename").click();

    await expect(plugged.locator("#result")).toHaveText('""');
  }

  const paths = video.outputPaths();
  const metadata = await video.metadata();
  const promptFill = metadata.highlights.find(
    (highlight) => highlight.method === "fill" && highlight.dialog?.type === "prompt",
  )!;
  const promptClick = metadata.highlights.find(
    (highlight) => highlight.method === "click" && highlight.dialog?.type === "prompt",
  )!;
  const frames = await videoFrames(paths.rendered, 25);
  const scale = Math.min(
    frames[0].width / promptFill.viewport.width,
    frames[0].height / promptFill.viewport.height,
  );
  const inputBox = {
    height: Math.round(promptFill.rect.height * scale),
    width: Math.round(promptFill.rect.width * scale),
    x: Math.round(promptFill.rect.x * scale),
    y: Math.round(promptFill.rect.y * scale),
  };
  const buttonBox = {
    height: Math.round(promptClick.rect.height * scale),
    width: Math.round(promptClick.rect.width * scale),
    x: Math.round(promptClick.rect.x * scale),
    y: Math.round(promptClick.rect.y * scale),
  };
  const dialogFrames = frames.filter(
    (frame) =>
      countPixels(
        frame,
        inset(inputBox, 3),
        ({ blue, green, red }) => red > 220 && green > 220 && blue > 220,
      ) > inputBox.width * inputBox.height * 0.5,
  );
  const textBox = {
    height: inputBox.height - 12,
    width: Math.round(inputBox.width * 0.5),
    x: inputBox.x + 8,
    y: inputBox.y + 6,
  };
  const textPixels = dialogFrames.map((frame) =>
    countPixels(
      frame,
      textBox,
      ({ blue, green, red }) => red < 80 && green < 80 && blue < 80,
    ),
  );
  const defaultFrame = textPixels.findIndex((count) => count > 30);
  const firstBlankFrame = textPixels.findIndex(
    (count, index) => index > defaultFrame && count < 25,
  );
  const firstSelectedFrame = dialogFrames.findIndex(
    (frame) =>
      countPixels(
        frame,
        inset(buttonBox, 6),
        ({ blue, green, red }) => blue > 150 && blue > red * 1.4 && blue > green * 1.1,
      ) > 100,
  );

  expect(defaultFrame).toBeGreaterThanOrEqual(0);
  expect(firstBlankFrame).toBeGreaterThan(defaultFrame);
  expect(firstSelectedFrame).toBeGreaterThan(firstBlankFrame);
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
  const finalGreenFrameCount = [...(await videoFrames(paths.rendered, 25))]
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

test("uses the default final hold without leaving the pointer visible", async ({
  page,
}, testInfo) => {
  const highlightDurationMs = 700;
  const video = videoMode({
    trimStart: "never",
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
  const cleanTailFrameCount = [...(await videoFrames(renderedPath, 25))]
    .reverse()
    .findIndex((frame) => cursorPixelCount(frame, targetBox) > 10);
  expect(cleanTailFrameCount).toBeGreaterThanOrEqual(10);
  expect(cleanTailFrameCount).toBeLessThan(40);
});

test("points at a visible result after waitFor without delaying the test", async ({
  page,
}, testInfo) => {
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

    const waitStartedAt = performance.now();
    await plugged.locator("#ready").waitFor();
    expect(performance.now() - waitStartedAt).toBeLessThan(600);
    await plugged.waitForTimeout(900);
    await plugged.locator("#run").click();
    await expect(plugged.locator("body")).toHaveAttribute("data-clicked", "true");
    await page.waitForTimeout(200);
  }

  const paths = video.outputPaths();
  const metadata = await video.metadata();
  const [waitHighlight, clickHighlight] = metadata.highlights;
  expect(metadata.highlights).toMatchObject([
    { method: "waitFor", rect: { height: 100, width: 140, x: 80, y: 140 } },
    { method: "click", rect: { height: 100, width: 140, x: 560, y: 140 } },
  ]);

  const renderedPath = paths.rendered;
  const waitHoldStart = renderedHighlightStartWithoutDeadAir(
    waitHighlight,
    metadata.highlights,
  );
  const clickHoldStart = renderedHighlightStartWithoutDeadAir(
    clickHighlight,
    metadata.highlights,
  );
  const waitHoldFrame = await videoFrame(
    renderedPath,
    waitHoldStart + highlightDurationMs - 100,
  );
  const clickHoldFrame = await videoFrame(
    renderedPath,
    clickHoldStart + highlightDurationMs - 100,
  );
  const scale = Math.min(
    waitHoldFrame.width / waitHighlight.viewport.width,
    waitHoldFrame.height / waitHighlight.viewport.height,
  );
  const readyBox = {
    height: Math.round(waitHighlight.rect.height * scale),
    width: Math.round(waitHighlight.rect.width * scale),
    x: Math.round(waitHighlight.rect.x * scale),
    y: Math.round(waitHighlight.rect.y * scale),
  };
  const runBox = {
    height: Math.round(clickHighlight.rect.height * scale),
    width: Math.round(clickHighlight.rect.width * scale),
    x: Math.round(clickHighlight.rect.x * scale),
    y: Math.round(clickHighlight.rect.y * scale),
  };

  expect(cursorPixelCount(waitHoldFrame, readyBox)).toBeGreaterThan(40);
  expect(cursorPixelCount(waitHoldFrame, runBox)).toBeLessThan(10);
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
  }

  const paths = video.outputPaths();
  const metadata = await video.metadata();
  const fillHighlight = metadata.highlights.find((highlight) => highlight.method === "fill")!;
  expect(fillHighlight).toBeDefined();

  const fillStart = renderedHighlightStartWithoutDeadAir(fillHighlight, metadata.highlights);
  const [earlyFrame, middleFrame, lateFrame] = await Promise.all(
    [200, 700, 950].map((offset) => videoFrame(paths.rendered, fillStart + offset)),
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

  expect(darkTextPixels[0]).toBeLessThan(10);
  expect(darkTextPixels[0]).toBeLessThan(darkTextPixels[1]);
  expect(darkTextPixels[1]).toBeLessThan(darkTextPixels[2]);
  expect(darkTextPixels[2]).toBeGreaterThan(300);

  const outsideField = averagePixel(lateFrame, { x: 30, y: 30 });
  expect(outsideField.blue).toBeGreaterThan(120);
  expect(outsideField.red).toBeLessThan(80);
});

test.skip("does not paste a future input over an earlier page state", async ({
  page,
}, testInfo) => {
  const video = videoMode({
    finalHold: 0,
    highlight: { mode: "outline", duration: 600 },
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
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; font: 24px sans-serif; }
        [hidden] { display: none !important; }
        section { position: fixed; inset: 0; padding: 40px; }
        #welcome { background: rgb(220, 20, 30); color: white; }
        #editor { background: rgb(20, 180, 40); }
        input {
          position: absolute;
          left: 250px;
          top: 150px;
          width: 300px;
          height: 100px;
          border: 0;
          padding: 20px;
          background: rgb(20, 80, 230);
          color: white;
          caret-color: transparent;
          font: 32px monospace;
        }
      </style>
      <section id="welcome">
        <h1>Welcome back</h1>
        <button>Sign in</button>
      </section>
      <section id="editor" hidden>
        <h1>Edit todo</h1>
        <label>Title <input aria-label="Title" /></label>
      </section>
      <script>
        document.querySelector("button").addEventListener("click", () => {
          document.querySelector("#welcome h1").textContent = "Signing in...";
          setTimeout(() => {
            document.querySelector("#welcome").hidden = true;
            document.querySelector("#editor").hidden = false;
          }, 2_000);
        });
      </script>
    `);

    await plugged.waitForTimeout(1_000);
    await plugged.getByRole("button", { name: "Sign in" }).click();
    await plugged.waitForTimeout(2_700);
    await plugged.getByLabel("Title").fill("Check the demo pacing");
  }

  const metadata = await video.metadata();
  const fillHighlight = metadata.highlights.find(
    (highlight) => highlight.method === "fill" && !highlight.dialog,
  )!;
  expect(fillHighlight).toBeDefined();
  const frames = await videoFrames(video.outputPaths().rendered, 25);
  const scale = Math.min(
    frames[0].width / fillHighlight.viewport.width,
    frames[0].height / fillHighlight.viewport.height,
  );
  const welcomeMarker = {
    height: Math.round(60 * scale),
    width: Math.round(60 * scale),
    x: Math.round(20 * scale),
    y: Math.round(350 * scale),
  };
  const inputInterior = inset(
    {
      height: Math.round(fillHighlight.rect.height * scale),
      width: Math.round(fillHighlight.rect.width * scale),
      x: Math.round(fillHighlight.rect.x * scale),
      y: Math.round(fillHighlight.rect.y * scale),
    },
    Math.round(16 * scale),
  );
  const hybridFrames = frames.flatMap((frame, index) => {
    const hasWelcomeBackground =
      countPixels(
        frame,
        welcomeMarker,
        ({ blue, green, red }) => red > 160 && green < 80 && blue < 80,
      ) >
      welcomeMarker.width * welcomeMarker.height * 0.9;
    const hasFutureInput =
      countPixels(
        frame,
        inputInterior,
        ({ blue, green, red }) => blue > 150 && red < 80 && green < 130,
      ) >
      inputInterior.width * inputInterior.height * 0.6;

    return hasWelcomeBackground && hasFutureInput ? [index] : [];
  });

  expect(
    hybridFrames,
    "rendered frames must not paste the future Title input over the Welcome view",
  ).toEqual([]);
});

test("reveals complete glyphs instead of slicing through the next character", async ({
  page,
}, testInfo) => {
  const highlightDurationMs = 1000;
  const video = videoMode({
    captions: "explicit",
    finalHold: 1000,
    highlight: { mode: "outline", duration: highlightDurationMs },
    trimStart: ["selector", 'input[aria-label="Code"]'],
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
    await plugged.getByLabel("Code").waitFor();

    await plugged.videoMode.caption("Reveal complete glyphs", async () => {
      await plugged.getByLabel("Code").fill("A @ B");
      await expect(plugged.getByLabel("Code")).toHaveValue("A @ B");
    });
  }

  const paths = video.outputPaths();
  const metadata = await video.metadata();
  const fillHighlight = metadata.highlights.find((highlight) => highlight.method === "fill")!;
  expect(fillHighlight).toBeDefined();

  const fillStart = renderedHighlightStartWithoutDeadAir(fillHighlight, metadata.highlights);
  const frames = await videoFrames(paths.rendered, 25);
  const finalFrame = frames.at(-1)!;
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
    finalHold: 1000,
    highlight: { mode: "pointer", duration: highlightDurationMs },
    skipMethods: ["waitFor"],
    trimStart: ["selector", 'input[aria-label="Name"]'],
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
        style="position: absolute; box-sizing: border-box; left: 340px; top: 160px; width: 420px; height: 90px; border: 0; padding: 12px 20px; background: rgb(0, 80, 255); color: rgb(230, 0, 0); caret-color: transparent; font: 42px monospace"
      />
    `);
    await plugged.getByLabel("Name").waitFor();

    await plugged.videoMode.caption("Move, switch cursor, then reveal", async () => {
      await plugged.getByLabel("Name").fill("Ada Lovelace");
      await expect(plugged.getByLabel("Name")).toHaveValue("Ada Lovelace");
    });
  }

  const paths = video.outputPaths();
  const metadata = await video.metadata();
  const fillHighlight = metadata.highlights.find((highlight) => highlight.method === "fill")!;
  expect(fillHighlight).toBeDefined();

  const fillStart = renderedHighlightStartWithoutDeadAir(fillHighlight, metadata.highlights);
  const frames = await videoFrames(paths.rendered, 25);
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
  expect(firstRevealFrame - textCursorFrame).toBeGreaterThanOrEqual(7);
  const boundaryColors = [frames[0], ...frames.slice(-10)].map((frame) =>
    averagePixel(frame, { x: 30, y: 420 }),
  );
  expect(
    boundaryColors.map(
      ({ blue, green, red }) => blue > 220 && green > 220 && red > 220,
    ),
  ).toEqual(Array.from({ length: 11 }, () => true));
});

test("preserves gradient field pixels while revealing the filled text", async ({
  page,
}, testInfo) => {
  const highlightDurationMs = 1000;
  const video = videoMode({
    captions: "explicit",
    finalHold: 1000,
    highlight: { mode: "outline", duration: highlightDurationMs },
    trimStart: ["selector", 'input[aria-label="Gradient"]'],
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
    await plugged.getByLabel("Gradient").waitFor();

    await plugged.videoMode.caption("Preserve gradient pixels", async () => {
      await plugged.getByLabel("Gradient").fill("Ada");
      await expect(plugged.getByLabel("Gradient")).toHaveValue("Ada");
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
  const highlightDurationMs = 1600;
  const video = videoMode({
    captions: "explicit",
    finalHold: 1000,
    highlight: { mode: "outline", duration: highlightDurationMs },
    trimStart: ["selector", 'textarea[aria-label="Notes"]'],
  });
  {
    await using plugged = await addPlugins({
      page,
      testInfo,
      plugins: [video],
    });
    await plugged.setViewportSize({ width: 800, height: 450 });
    await plugged.setContent(`
      <style>
        textarea::placeholder { color: rgb(170, 20, 170); opacity: 1; }
      </style>
      <textarea
        aria-label="Notes"
        placeholder="Write some notes"
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
    await plugged.getByLabel("Notes").waitFor();

    await plugged.videoMode.caption("Replace the placeholder", async () => {
      await plugged.getByLabel("Notes").click();
      await expect(plugged.getByLabel("Notes")).toBeFocused();
      await plugged.getByLabel("Notes").fill("Ada notes");
      await expect(plugged.getByLabel("Notes")).toHaveValue("Ada notes");
      await expect(plugged.locator("body")).toHaveAttribute(
        "data-seen-values",
        JSON.stringify(["Ada notes"]),
      );
    });
  }

  const paths = video.outputPaths();
  const metadata = await video.metadata();
  const waitHighlight = metadata.highlights.find((highlight) => highlight.method === "waitFor")!;
  const clickHighlight = metadata.highlights.find((highlight) => highlight.method === "click")!;
  const fillHighlight = metadata.highlights.find((highlight) => highlight.method === "fill")!;
  expect(metadata.highlights.map((highlight) => highlight.method)).toEqual([
    "waitFor",
    "click",
    "fill",
  ]);
  expect(waitHighlight.start).toBeGreaterThanOrEqual(metadata.sourceRange.start!);
  expect(clickHighlight).toBeDefined();
  expect(fillHighlight.fillReveal).toBeDefined();

  const placeholderStart = renderedHighlightStartWithoutDeadAir(
    clickHighlight,
    metadata.highlights,
  );
  const renderedFrames = await videoFrames(paths.rendered, 25);
  const [placeholderFrame] = await videoFramesAt(paths.rendered, [placeholderStart + 500]);
  const lateFrame = renderedFrames.at(-1)!;
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
  const darkTextPixels = renderedFrames.map((frame) =>
    countPixels(
      frame,
      textBox,
      ({ blue, green, red }) => red < 80 && green < 80 && blue < 80,
    ),
  );
  const placeholderPixels = renderedFrames.map((frame) =>
    countPixels(
      frame,
      textBox,
      ({ blue, green, red }) => red > 120 && green < 80 && blue > 120,
    ),
  );
  const placeholderPixelCount = countPixels(
    placeholderFrame,
    textBox,
    ({ blue, green, red }) => red > 120 && green < 80 && blue > 120,
  );

  expect(placeholderPixelCount).toBeGreaterThan(100);
  expect(
    renderedFrames.some(
      (_, index) => placeholderPixels[index] < 10 && darkTextPixels[index] < 10,
    ),
  ).toBe(true);
  const textSizedDarkPixelCounts = darkTextPixels.filter(
    (darkPixels) => darkPixels > 10 && darkPixels < 10_000,
  );
  const completedTextPixels = Math.max(...textSizedDarkPixelCounts);
  expect(completedTextPixels).toBeGreaterThan(300);
  expect(
    darkTextPixels.some(
      (darkPixels) => darkPixels > 10 && darkPixels < completedTextPixels,
    ),
  ).toBe(true);
  const firstRevealedFrameIndex = darkTextPixels.findIndex(
    (darkPixels, frame) =>
      darkPixels > 10 && darkPixels < 10_000 && placeholderPixels[frame] < 100,
  );
  expect(firstRevealedFrameIndex).toBeGreaterThanOrEqual(0);
  expect(
    placeholderPixels
      .map((pixels, frame) => ({ frame, pixels }))
      .slice(firstRevealedFrameIndex)
      .filter(({ pixels }) => pixels > 100),
  ).toEqual([]);
});

test("reveals a scrolling textarea one visible line at a time", async ({
  page,
}, testInfo) => {
  const highlightDurationMs = 1600;
  const video = videoMode({
    captions: "explicit",
    finalHold: 1000,
    highlight: { mode: "outline", duration: highlightDurationMs },
    trimStart: ["selector", 'textarea[aria-label="Log"]'],
  });
  {
    await using plugged = await addPlugins({
      page,
      testInfo,
      plugins: [video],
    });
    await plugged.setViewportSize({ width: 800, height: 450 });
    await plugged.setContent(`
      <style>
        textarea::placeholder { color: rgb(170, 20, 170); opacity: 1; }
      </style>
      <textarea
        aria-label="Log"
        placeholder="Add log entries"
        style="position: absolute; box-sizing: border-box; left: 220px; top: 120px; width: 360px; height: 136px; border: 0; padding: 14px; resize: none; background: white; color: black; font: 30px/36px monospace"
      ></textarea>
    `);
    await plugged.getByLabel("Log").waitFor();

    await plugged.videoMode.caption("Reveal the visible scrolled lines", async () => {
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
    });
  }

  const metadata = await video.metadata();
  const fillHighlight = metadata.highlights.find((highlight) => highlight.method === "fill")!;
  expect(fillHighlight).toBeDefined();
  expect(fillHighlight.fillReveal).toBeDefined();
  const fillStart = renderedHighlightStartWithoutDeadAir(
    fillHighlight,
    metadata.highlights,
  );
  const frames = await videoFramesAt(
    video.outputPaths().rendered,
    [200, 850, 950, 1050, 1150, 1250, 1350, 1450, 1580].map(
      (offset) => fillStart + offset,
    ),
  );
  const scale = Math.min(
    frames[0].width / fillHighlight.viewport.width,
    frames[0].height / fillHighlight.viewport.height,
  );
  const darkTextPixels = frames.map((frame) =>
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
  );
  expect(darkTextPixels[0]).toBeLessThan(10);
  expect(darkTextPixels.at(-1)).toBeGreaterThan(200);
  const contentBox = {
    height: Math.round((fillHighlight.rect.height - 28) * scale),
    width: Math.round((fillHighlight.rect.width - 28) * scale),
    x: Math.round((fillHighlight.rect.x + 14) * scale),
    y: Math.round((fillHighlight.rect.y + 14) * scale),
  };
  expect(
    frames.slice(1).some((frame) => {
      const firstLineDarkPixels = countPixels(
        frame,
        { ...contentBox, height: Math.round(36 * scale) },
        ({ blue, green, red }) => red < 80 && green < 80 && blue < 80,
      );
      const laterLinesDarkPixels = countPixels(
        frame,
        {
          ...contentBox,
          height: contentBox.height - Math.round(36 * scale),
          y: contentBox.y + Math.round(36 * scale),
        },
        ({ blue, green, red }) => red < 80 && green < 80 && blue < 80,
      );
      return firstLineDarkPixels > 50 && laterLinesDarkPixels < 10;
    }),
  ).toBe(true);
  expect(
    countPixels(
      frames[0],
      inset(
        {
          height: Math.round(fillHighlight.rect.height * scale),
          width: Math.round(fillHighlight.rect.width * scale),
          x: Math.round(fillHighlight.rect.x * scale),
          y: Math.round(fillHighlight.rect.y * scale),
        },
        10,
      ),
      ({ blue, green, red }) => red > 120 && green < 80 && blue > 120,
    ),
  ).toBeLessThan(10);
});

test("reveals the final visible portion of a horizontally scrolling input", async ({
  page,
}, testInfo) => {
  const highlightDurationMs = 1600;
  const video = videoMode({
    captions: "explicit",
    finalHold: 1000,
    highlight: { mode: "outline", duration: highlightDurationMs },
    trimStart: ["selector", 'input[aria-label="Reference"]'],
  });
  {
    await using plugged = await addPlugins({
      page,
      testInfo,
      plugins: [video],
    });
    await plugged.setViewportSize({ width: 800, height: 450 });
    await plugged.setContent(`
      <style>
        input::placeholder { color: rgb(170, 20, 170); opacity: 1; }
      </style>
      <input
        aria-label="Reference"
        placeholder="Add a reference"
        style="position: absolute; box-sizing: border-box; left: 220px; top: 160px; width: 360px; height: 80px; padding: 14px; background: white; color: black; font: 30px monospace"
      />
    `);
    await plugged.getByLabel("Reference").waitFor();

    await plugged.videoMode.caption("Reveal the visible reference suffix", async () => {
      await plugged
        .getByLabel("Reference")
        .fill("prefix-that-scrolls-out-of-view-visible-reference-end");
      await expect(plugged.getByLabel("Reference")).toHaveValue(
        "prefix-that-scrolls-out-of-view-visible-reference-end",
      );
      await expect
        .poll(() => plugged.getByLabel("Reference").evaluate((input) => input.scrollLeft))
        .toBeGreaterThan(0);
    });
  }

  const metadata = await video.metadata();
  const fillHighlight = metadata.highlights.find((highlight) => highlight.method === "fill")!;
  expect(fillHighlight.fillReveal).toBeDefined();
  const fillStart = renderedHighlightStartWithoutDeadAir(
    fillHighlight,
    metadata.highlights,
  );
  const frames = await videoFramesAt(
    video.outputPaths().rendered,
    [200, 850, 950, 1050, 1150, 1250, 1350, 1450, 1580].map(
      (offset) => fillStart + offset,
    ),
  );
  const scale = Math.min(
    frames[0].width / fillHighlight.viewport.width,
    frames[0].height / fillHighlight.viewport.height,
  );
  const darkTextPixels = frames.map((frame) =>
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
  );
  expect(darkTextPixels[0]).toBeLessThan(10);
  expect(darkTextPixels.at(-1)).toBeGreaterThan(100);
  expect(
    darkTextPixels
      .slice(1, -1)
      .some((darkPixels) => darkPixels > 10 && darkPixels < darkTextPixels.at(-1)!),
  ).toBe(true);
  expect(
    countPixels(
      frames[0],
      inset(
        {
          height: Math.round(fillHighlight.rect.height * scale),
          width: Math.round(fillHighlight.rect.width * scale),
          x: Math.round(fillHighlight.rect.x * scale),
          y: Math.round(fillHighlight.rect.y * scale),
        },
        10,
      ),
      ({ blue, green, red }) => red > 120 && green < 80 && blue > 120,
    ),
  ).toBeLessThan(10);
});

test("reveals an expanding textarea one line at a time at its final geometry", async ({
  page,
}, testInfo) => {
  const highlightDurationMs = 1600;
  const video = videoMode({
    captions: "explicit",
    finalHold: 1000,
    highlight: { mode: "outline", duration: highlightDurationMs },
    trimStart: ["selector", 'textarea[aria-label="Summary"]'],
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
      <style>
        textarea::placeholder { color: rgb(170, 20, 170); opacity: 1; }
      </style>
      <textarea
        aria-label="Summary"
        placeholder="Add a summary"
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
    await plugged.getByLabel("Summary").waitFor();
    initialHeight = (await plugged.getByLabel("Summary").boundingBox())!.height;

    await plugged.videoMode.caption("Reveal at the expanded size", async () => {
      await plugged
        .getByLabel("Summary")
        .fill("This textarea grows to fit a longer summary without scrolling.");
      await expect(plugged.getByLabel("Summary")).toHaveValue(
        "This textarea grows to fit a longer summary without scrolling.",
      );
      await expect
        .poll(async () => (await plugged.getByLabel("Summary").boundingBox())!.height)
        .toBeGreaterThan(initialHeight);
    });
  }

  const metadata = await video.metadata();
  const fillHighlight = metadata.highlights.find((highlight) => highlight.method === "fill")!;
  expect(fillHighlight).toBeDefined();
  expect(fillHighlight.fillReveal).toBeDefined();
  expect(fillHighlight.rect.height).toBeGreaterThan(initialHeight);
  const frames = await videoFrames(video.outputPaths().rendered, 25);
  const fillStartFrame = Math.floor(
    renderedHighlightStartWithoutDeadAir(fillHighlight, metadata.highlights) / 40,
  );
  const scale = Math.min(
    frames[0].width / fillHighlight.viewport.width,
    frames[0].height / fillHighlight.viewport.height,
  );
  const outlinedFrames = frames.slice(fillStartFrame).flatMap((frame) => {
    const yellowPixels = countPixels(
      frame,
      { height: frame.height, width: frame.width, x: 0, y: 0 },
      ({ blue, green, red }) => red > 180 && green > 160 && blue < 100,
    );
    return yellowPixels > 20 ? [{ frame, outline: yellowBoundingBox(frame) }] : [];
  });
  const earlyOutlinedFrame = outlinedFrames.find(
    ({ outline }) => outline.height < Math.round(fillHighlight.rect.height * scale * 0.75),
  );
  const lateOutlinedFrame = outlinedFrames.find(
    ({ outline }) => outline.height > Math.round(fillHighlight.rect.height * scale * 0.9),
  );
  expect(earlyOutlinedFrame).toBeDefined();
  expect(lateOutlinedFrame).toBeDefined();
  const earlyOutline = earlyOutlinedFrame!.outline;
  const lateOutline = lateOutlinedFrame!.outline;
  expect(earlyOutline.height).toBeLessThan(
    Math.round(fillHighlight.rect.height * scale * 0.75),
  );
  expect(lateOutline.height).toBeGreaterThan(earlyOutline.height * 2);
  const darkTextPixels = frames.map((frame) =>
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
  );
  const firstOutlinedFrameIndex = frames.indexOf(earlyOutlinedFrame!.frame);
  expect(
    darkTextPixels
      .slice(0, firstOutlinedFrameIndex)
      .map((pixels, frame) => ({ frame, pixels }))
      .filter(({ pixels }) => pixels > 200 && pixels < 10_000),
  ).toEqual([]);
  expect(
    countPixels(
      earlyOutlinedFrame!.frame,
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
  ).toBeLessThan(10);
  const completedTextPixels = Math.max(...darkTextPixels);
  expect(completedTextPixels).toBeGreaterThan(200);
  expect(
    darkTextPixels.some(
      (darkPixels) => darkPixels > 10 && darkPixels < completedTextPixels,
    ),
  ).toBe(true);
  const contentRect = fillHighlight.fillReveal!.contentRect;
  const contentBox = {
    height: Math.round(contentRect.height * scale),
    width: Math.round(contentRect.width * scale),
    x: Math.round(contentRect.x * scale),
    y: Math.round(contentRect.y * scale),
  };
  const firstLineHeight = Math.round(36 * scale);
  const showsOnlyTheFirstLine = frames.some((frame) => {
    const firstLineDarkPixels = countPixels(
      frame,
      { ...contentBox, height: firstLineHeight },
      ({ blue, green, red }) => red < 80 && green < 80 && blue < 80,
    );
    const laterLinesDarkPixels = countPixels(
      frame,
      {
        ...contentBox,
        height: contentBox.height - firstLineHeight,
        y: contentBox.y + firstLineHeight,
      },
      ({ blue, green, red }) => red < 80 && green < 80 && blue < 80,
    );
    return firstLineDarkPixels > 50 && laterLinesDarkPixels < 10;
  });
  expect(showsOnlyTheFirstLine).toBe(true);
  expect(
    countPixels(
      earlyOutlinedFrame!.frame,
      inset(
        {
          height: Math.round(fillHighlight.rect.height * scale),
          width: Math.round(fillHighlight.rect.width * scale),
          x: Math.round(fillHighlight.rect.x * scale),
          y: Math.round(fillHighlight.rect.y * scale),
        },
        10,
      ),
      ({ blue, green, red }) => red > 120 && green < 80 && blue > 120,
    ),
  ).toBeLessThan(10);
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

test("does not calibrate against an earlier occurrence of the final page state", async ({
  page,
}, testInfo) => {
  const video = videoMode({
    trimStart: "never",
    finalHold: 500,
    highlight: { mode: "pointer", duration: 600 },
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
        <button id="open" style="position: absolute; left: 80px; top: 80px; width: 160px; height: 80px">Open</button>
        <dialog style="width: 300px; height: 200px; background: white">
          <p>Dialog ready</p>
          <button id="close">Close</button>
        </dialog>
        <script>
          const dialog = document.querySelector("dialog");
          document.querySelector("#open").addEventListener("click", () => {
            document.body.style.background = "rgb(220, 0, 0)";
            dialog.showModal();
          });
          document.querySelector("#close").addEventListener("click", () => {
            dialog.close();
            document.body.style.background = "rgb(0, 180, 0)";
          });
        </script>
      </body>
    `);

    await plugged.waitForTimeout(1200);
    await plugged.locator("#open").click();
    await plugged.getByText("Dialog ready").waitFor();
    await plugged.waitForTimeout(2000);
    await plugged.locator("#close").click();
  }

  const frames = await videoFrames(video.outputPaths().rendered, 25);
  const states = frames.map((frame) => {
    const color = averagePixel(frame, { x: 500, y: 400 });
    if (color.green > color.red + 80) return "green";
    if (color.red > color.green + 80) return "red";
    return "other";
  });
  const transitions = states.filter((state, index) => state !== states[index - 1]);

  expect(transitions).toEqual(["green", "red", "green"]);
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
  const frames = await videoFrames(renderedPath, 25);
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

const releaseDemoPage = (path: string) => {
  if (path === "/runs") {
    return releaseDemoLayout(
      "Recent runs",
      `
        <label>Search releases <input aria-label="Search releases" placeholder="Release name" /></label>
        <button onclick="document.querySelector('[data-pending]').remove(); this.setAttribute('aria-pressed', 'true')">Ready only</button>
        <section>
          <article><b>Release 2026.7</b><span>Ready · 128 specs · 0 retries</span></article>
          <article data-pending><b>Release 2026.8-beta</b><span>Running · 84 of 128 specs</span></article>
        </section>
      `,
    );
  }

  if (path === "/releases/2026.7") {
    return releaseDemoLayout(
      "Everything is ready.",
      `
        <button onclick="this.setAttribute('aria-pressed', 'true'); document.querySelector('#browser').textContent = '48 Chromium specs passed'">Chromium</button>
        <button>Firefox</button>
        <button>WebKit</button>
        <section>
          <article><b id="browser">128 specs passed</b><span>Across all supported browsers</span></article>
          <article><b>4m 12s</b><span>Total run time</span></article>
          <article><b>0 retries</b><span>No flaky tests found</span></article>
        </section>
      `,
    );
  }

  return releaseDemoLayout(
    "48 specs passed",
    `
      <p>No retries, errors, or quarantined tests.</p>
      <button onclick="document.querySelector('table').hidden = false; this.remove()">Show slowest specs</button>
      <table hidden>
        <thead><tr><th>Spec</th><th>Duration</th><th>Result</th></tr></thead>
        <tbody>
          <tr><td>checkout › applies annual discount</td><td>4.8s</td><td>Passed</td></tr>
          <tr><td>reports › exports account summary</td><td>3.9s</td><td>Passed</td></tr>
        </tbody>
      </table>
    `,
  );
};

const releaseDemoLayout = (title: string, body: string) => `
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    body { margin: 0; background: #f5f7fb; color: #182230; font: 16px Arial, sans-serif; }
    nav { padding: 22px 40px; border-bottom: 1px solid #e3e8ef; background: white; font-weight: 700; }
    main { max-width: 900px; margin: 0 auto; padding: 42px; }
    h1 { margin: 0 0 24px; font-size: 38px; }
    label { display: inline-grid; gap: 6px; margin-right: 10px; color: #4b5565; font-size: 13px; font-weight: 700; }
    input, button { padding: 10px 14px; border: 1px solid #cdd5df; border-radius: 9px; background: white; font: inherit; }
    button[aria-pressed="true"] { border-color: #3459db; background: #3459db; color: white; }
    section { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 20px; }
    article { display: grid; gap: 10px; min-height: 110px; padding: 22px; border: 1px solid #e3e8ef; border-radius: 14px; background: white; }
    article span { color: #697586; }
    table { width: 100%; margin-top: 18px; border-collapse: collapse; background: white; }
    th, td { padding: 14px; border-bottom: 1px solid #e3e8ef; text-align: left; }
  </style>
  <nav>Middlewright · Release dashboard</nav>
  <main><h1>${title}</h1>${body}</main>
`;

const topEdgeActionPage = () => `
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #f3f6fb; color: #172033; font: 16px Arial, sans-serif; }
    header { height: 64px; padding: 9px 18px; border-bottom: 1px solid #d8deea; background: white; }
    header b { display: inline-block; padding: 12px 0; }
    button { float: right; padding: 10px 16px; border: 0; border-radius: 8px; background: #3157d5; color: white; font: inherit; font-weight: 700; }
    main { max-width: 760px; margin: 0 auto; padding: 48px 36px; }
    h1 { margin: 0 0 14px; font-size: 38px; }
    p { color: #5d687c; }
    article { margin-top: 28px; padding: 24px; border: 1px solid #d8deea; border-radius: 14px; background: white; }
    [role="status"] { color: #16734a; font-weight: 700; }
  </style>
  <header>
    <b>Middlewright · Run #128</b>
    <button onclick="document.querySelector('[role=status]').textContent = 'Run approved'">Approve run</button>
  </header>
  <main>
    <h1>Release checks passed</h1>
    <p>All required browser and accessibility checks are green.</p>
    <article>
      <b>128 specs passed</b>
      <p>No retries or quarantined tests.</p>
      <span role="status">Waiting for approval</span>
    </article>
  </main>
`;

const hasAddressBar = (frame: VideoFrame) => {
  const height = Math.min(70, frame.height);
  const darkPixels = countPixels(
    frame,
    { height, width: frame.width, x: 0, y: 0 },
    ({ blue, green, red }) => red > 30 && red < 125 && green > 30 && green < 125 && blue > 30 && blue < 125,
  );

  return darkPixels > frame.width * Math.min(40, height);
};

const hasWhiteCaption = (frame: VideoFrame) => {
  const whitePixels = countPixels(
    frame,
    {
      height: Math.round(frame.height * 0.3),
      width: frame.width,
      x: 0,
      y: Math.round(frame.height * 0.7),
    },
    ({ blue, green, red }) => red > 220 && green > 220 && blue > 220,
  );

  return whitePixels > 100;
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

const videoFrames = async (path: string, framesPerSecond: number): Promise<VideoFrame[]> => {
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
      `fps=${framesPerSecond}`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ],
    {
      encoding: "buffer",
      maxBuffer: 256 * 1024 * 1024,
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

const videoFramesAt = async (path: string, timestampsMs: number[]) => {
  // 25fps: one frame per 40ms, matching the index arithmetic below.
  const frames = await videoFrames(path, 25);
  return timestampsMs.map((timestampMs) =>
    frames[Math.max(0, Math.min(frames.length - 1, Math.round(timestampMs / 40)))],
  );
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

const pixelBoundingBox = (
  frame: VideoFrame,
  rect: { height: number; width: number; x: number; y: number },
  predicate: (pixel: { blue: number; green: number; red: number }) => boolean,
) => {
  let minX = rect.x + rect.width;
  let minY = rect.y + rect.height;
  let maxX = -1;
  let maxY = -1;
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
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return undefined;
  }

  return {
    height: maxY - minY + 1,
    width: maxX - minX + 1,
    x: minX,
    y: minY,
  };
};
