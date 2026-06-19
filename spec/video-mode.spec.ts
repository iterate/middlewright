import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { addPlugins, videoMode } from "../src/index.ts";

test("highlights the element while the action runs, then cleans up", async ({
  page,
}, testInfo) => {
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [videoMode({ pauseBefore: 300, pauseAfterTest: 50 })],
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

  await plugged.locator("#btn").click();

  await expect(plugged.locator("#result")).toContainText("outline: 3px solid gold");
  // Cleanup is fire-and-forget, so poll until the highlight is gone
  await expect
    .poll(() => plugged.locator("#btn").getAttribute("style"))
    .not.toContain("gold");
});

test("skipped methods are not highlighted or slowed down", async ({ page }, testInfo) => {
  const video = videoMode({ pauseBefore: 5000, pauseAfterTest: 50, skipMethods: ["click"] });
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
  // A 5s pauseBefore would blow way past this if click weren't skipped
  expect(Date.now() - start).toBeLessThan(2000);
  expect(video.metadata().deadAir.some((span) => span.end - span.start >= 100)).toBe(true);
});

test("marks pre-action waits for attachment as dead air", async ({ page }, testInfo) => {
  const video = videoMode({ pauseBefore: 20, pauseAfterTest: 50 });
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
    plugins: [videoMode({ pauseBefore: 20, pauseAfterTest: 50 })],
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
  const video = videoMode({ pauseBefore: 20, pauseAfterTest: 50 });
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
  const video = videoMode({ pauseBefore: 5000, pauseAfterTest: 50 });
  {
    await using plugged = await addPlugins({
      page,
      testInfo,
      plugins: [video],
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
    await video.deadAir(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await plugged.locator("#btn").click();
    });

    expect(Date.now() - start).toBeLessThan(2000);
    await expect(plugged.locator("#result")).toContainText("(no style)");
    expect(video.metadata()).toMatchObject({
      outputs: {},
      schemaVersion: 1,
      timebase: "ms",
    });
    expect(video.metadata().deadAir).toContainEqual(
      expect.objectContaining({ end: expect.any(Number), start: expect.any(Number) }),
    );
  }

  const metadata = JSON.parse(
    await readFile(join(testInfo.outputDir, "video-mode.json"), "utf8"),
  );
  expect(metadata).toMatchObject({
    outputs: {},
    schemaVersion: 1,
    timebase: "ms",
  });
  expect(metadata.deadAir).toContainEqual(
    expect.objectContaining({ end: expect.any(Number), start: expect.any(Number) }),
  );
  expect(metadata.deadAir[0].end).toBeGreaterThan(metadata.deadAir[0].start);
});
