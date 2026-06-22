import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { addPlugins, videoMode } from "../src/index.ts";

test("records highlight metadata without mutating element styles", async ({
  page,
}, testInfo) => {
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [videoMode({ finalHold: 50, highlightDuration: 300 })],
  });
  await plugged.setContent(`
    <button id="btn">press</button>
    <div id="result"></div>
    <script>
      document.getElementById('btn').addEventListener('click', function () {
        // Capture our own inline style at click time, so the test can see
        // what the element looked like while the action ran.
        document.getElementById('result').textContent = this.getAttribute('style') || '(no style)';
      });
    </script>
  `);

  const start = Date.now();
  await plugged.locator("#btn").click();

  expect(Date.now() - start).toBeLessThan(1000);
  await expect(plugged.locator("#result")).toContainText("(no style)");
  expect(plugged.videoMode.metadata().highlights).toContainEqual(
    expect.objectContaining({
      color: "gold",
      end: expect.any(Number),
      rect: expect.objectContaining({
        height: expect.any(Number),
        width: expect.any(Number),
        x: expect.any(Number),
        y: expect.any(Number),
      }),
      start: expect.any(Number),
      thickness: 3,
      viewport: expect.objectContaining({
        height: expect.any(Number),
        width: expect.any(Number),
      }),
    }),
  );
});

test("skipped methods are not highlighted", async ({ page }, testInfo) => {
  const video = videoMode({ finalHold: 50, highlightDuration: 5000, skipMethods: ["click"] });
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [video],
  });
  await plugged.setContent(`
    <script>
      setTimeout(() => {
        document.body.insertAdjacentHTML(
          'beforeend',
          '<button id="btn" onclick="this.textContent = \\'clicked\\'">press</button>',
        );
      }, 150);
    </script>
  `);

  const start = Date.now();
  await plugged.locator("#btn").click();
  expect(Date.now() - start).toBeLessThan(2000);
  expect(video.metadata().deadAir.some((span) => span.end - span.start >= 100)).toBe(true);
  expect(video.metadata().highlights).toEqual([]);
});

test("marks pre-action waits for attachment as dead air", async ({ page }, testInfo) => {
  const video = videoMode({ finalHold: 50, highlightDuration: 20 });
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [video],
  });
  await plugged.setContent(`
    <div id="result"></div>
    <script>
      setTimeout(() => {
        document.body.insertAdjacentHTML(
          'beforeend',
          '<button id="late" onclick="document.getElementById(\\'result\\').textContent = \\'clicked\\'">late</button>',
        );
      }, 150);
    </script>
  `);

  await plugged.locator("#late").click();

  await expect(plugged.locator("#result")).toContainText("clicked");
  expect(video.metadata().deadAir).toContainEqual(
    expect.objectContaining({
      end: expect.any(Number),
      start: expect.any(Number),
    }),
  );
  expect(video.metadata().deadAir.some((span) => span.end - span.start >= 100)).toBe(true);
});

test("pre-action attached waits honor action timeout", async ({ page }, testInfo) => {
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [videoMode({ finalHold: 50, highlightDuration: 20 })],
  });
  await plugged.setContent(`
    <script>
      setTimeout(() => {
        document.body.insertAdjacentHTML('beforeend', '<button id="late">late</button>');
      }, 300);
    </script>
  `);

  const start = Date.now();
  const error = await plugged.locator("#late").click({ timeout: 100 }).catch((e: Error) => e);

  expect(Date.now() - start).toBeLessThan(250);
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).toContain("Timeout 100ms exceeded");
});

test("marks explicit attached waitFor calls as dead air", async ({ page }, testInfo) => {
  const video = videoMode({ finalHold: 50, highlightDuration: 20 });
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [video],
  });
  await plugged.setContent(`
    <script>
      setTimeout(() => {
        document.body.insertAdjacentHTML('beforeend', '<div id="late">attached</div>');
      }, 150);
    </script>
  `);

  await plugged.locator("#late").waitFor({ state: "attached" });

  expect(video.metadata().deadAir.some((span) => span.end - span.start >= 100)).toBe(true);
});

test("deadAir runs actions without video highlighting and records metadata", async ({
  page,
}, testInfo) => {
  {
    await using plugged = await addPlugins({
      page,
      testInfo,
      plugins: [videoMode({ finalHold: 50, highlightDuration: 5000 })],
    });

    await plugged.setContent(`
      <button id="btn">press</button>
      <div id="result"></div>
      <script>
        document.getElementById('btn').addEventListener('click', function () {
          document.getElementById('result').textContent = this.getAttribute('style') || '(no style)';
        });
      </script>
    `);

    const start = Date.now();
    const videoTimestamp = plugged.videoMode.getVideoTimestamp();
    await plugged.videoMode.deadAir(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await plugged.locator("#btn").click();
    });

    expect(Date.now() - start).toBeLessThan(2000);
    expect(plugged.videoMode.getVideoTimestamp()).toBeGreaterThanOrEqual(videoTimestamp);
    await expect(plugged.locator("#result")).toContainText("(no style)");
    expect(plugged.videoMode.metadata()).toMatchObject({
      outputs: {},
      schemaVersion: 1,
      timebase: "ms",
    });
    expect(plugged.videoMode.metadata().deadAir).toContainEqual(
      expect.objectContaining({ end: expect.any(Number), start: expect.any(Number) }),
    );
    expect(plugged.videoMode.metadata().highlights).toEqual([]);
  }

  const metadata = JSON.parse(
    await readFile(join(testInfo.outputDir, "video-mode.json"), "utf8"),
  );
  expect(metadata).toMatchObject({
    highlights: [],
    outputs: {},
    schemaVersion: 1,
    timebase: "ms",
  });
  expect(metadata.deadAir).toContainEqual(
    expect.objectContaining({ end: expect.any(Number), start: expect.any(Number) }),
  );
  expect(metadata.deadAir[0].end).toBeGreaterThan(metadata.deadAir[0].start);
});
