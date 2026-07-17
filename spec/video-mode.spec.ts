import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { addPlugins, videoMode } from "../src/index.ts";

test("records highlight metadata without mutating element styles", async ({
  page,
}, testInfo) => {
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [videoMode({ finalHold: 50, highlight: { mode: "pointer", duration: 300 } })],
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
  await expect(plugged.videoMode.metadata()).resolves.toMatchObject({
    highlights: expect.arrayContaining([
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
    ]),
  });
});

test("records an accepted confirm as a synthetic dialog annotation", async ({
  page,
}, testInfo) => {
  const video = videoMode({
    finalHold: 0,
    highlight: { mode: "pointer", duration: 300 },
    trimStart: "never",
  });
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [video],
  });
  await plugged.setContent(`
    <button id="discard">Discard file</button>
    <output id="result"></output>
    <script>
      document.querySelector("#discard").addEventListener("click", () => {
        document.querySelector("#result").textContent = confirm(
          "Discard unsaved changes to release-notes.md?",
        ) ? "discarded" : "kept";
      });
    </script>
  `);
  plugged.once("dialog", (dialog) => dialog.accept());

  await plugged.locator("#discard").click();

  await expect(plugged.locator("#result")).toHaveText("discarded");
  await expect(video.metadata()).resolves.toMatchObject({
    highlights: expect.arrayContaining([
      expect.objectContaining({
        dialog: {
          action: "accept",
          message: "Discard unsaved changes to release-notes.md?",
          type: "confirm",
        },
        image: expect.stringMatching(/\.png$/),
        method: "click",
      }),
    ]),
  });
});

test("records prompt entry before the accepted prompt decision", async ({ page }, testInfo) => {
  const video = videoMode({
    finalHold: 0,
    highlight: { mode: "pointer", duration: 300 },
    trimStart: "never",
  });
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [video],
  });
  await plugged.setContent(`
    <button id="rename">Rename file</button>
    <output id="result"></output>
    <script>
      document.querySelector("#rename").addEventListener("click", () => {
        document.querySelector("#result").textContent = prompt("New file name", "draft.md") || "cancelled";
      });
    </script>
  `);
  plugged.once("dialog", (dialog) => dialog.accept("release-notes.md"));

  await plugged.locator("#rename").click();

  await expect(plugged.locator("#result")).toHaveText("release-notes.md");
  const dialogHighlights = (await video.metadata()).highlights.filter(
    (candidate) => candidate.dialog?.type === "prompt",
  );
  expect(dialogHighlights).toMatchObject([
    {
      dialog: {
        action: "accept",
        message: "New file name",
        promptText: "release-notes.md",
        type: "prompt",
      },
      image: expect.stringMatching(/\.png$/),
      method: "fill",
    },
    {
      dialog: {
        action: "accept",
        message: "New file name",
        promptText: "release-notes.md",
        type: "prompt",
      },
      image: expect.stringMatching(/\.png$/),
      method: "click",
    },
  ]);
});

test("preserves Playwright's automatic dialog dismissal", async ({ page }, testInfo) => {
  const video = videoMode({
    finalHold: 0,
    highlight: { mode: "pointer", duration: 300 },
    trimStart: "never",
  });
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [video],
  });
  await plugged.setContent(`
    <button id="discard">Discard file</button>
    <output id="result"></output>
    <script>
      document.querySelector("#discard").addEventListener("click", () => {
        document.querySelector("#result").textContent = confirm("Discard changes?") ? "discarded" : "kept";
      });
    </script>
  `);

  await plugged.locator("#discard").click();

  await expect(plugged.locator("#result")).toHaveText("kept");
  await expect(video.metadata()).resolves.toMatchObject({
    highlights: expect.arrayContaining([
      expect.objectContaining({
        dialog: {
          action: "dismiss",
          message: "Discard changes?",
          type: "confirm",
        },
        method: "click",
      }),
    ]),
  });
});

test("records an alert acknowledgement", async ({ page }, testInfo) => {
  const video = videoMode({
    finalHold: 0,
    highlight: { mode: "pointer", duration: 300 },
    trimStart: "never",
  });
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [video],
  });
  await plugged.setContent(`
    <button id="publish">Publish</button>
    <output id="result"></output>
    <script>
      document.querySelector("#publish").addEventListener("click", () => {
        alert("Release published");
        document.querySelector("#result").textContent = "done";
      });
    </script>
  `);
  plugged.once("dialog", (dialog) => dialog.accept());

  await plugged.locator("#publish").click();

  await expect(plugged.locator("#result")).toHaveText("done");
  await expect(video.metadata()).resolves.toMatchObject({
    highlights: expect.arrayContaining([
      expect.objectContaining({
        dialog: {
          action: "accept",
          message: "Release published",
          type: "alert",
        },
        method: "click",
      }),
    ]),
  });
});

test("skipped methods are not highlighted", async ({ page }, testInfo) => {
  const video = videoMode({
    finalHold: 50,
    highlight: { mode: "pointer", duration: 5000 },
    skipMethods: ["click"],
  });
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
  const metadata = await video.metadata();
  expect(metadata.deadAir.some((span) => span.end - span.start >= 100)).toBe(true);
  expect(metadata.highlights).toEqual([]);
});

test("marks pre-action waits for attachment as dead air", async ({ page }, testInfo) => {
  const video = videoMode({ finalHold: 50, highlight: { mode: "pointer", duration: 20 } });
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
  const metadata = await video.metadata();
  expect(metadata.deadAir).toContainEqual(
    expect.objectContaining({
      end: expect.any(Number),
      start: expect.any(Number),
    }),
  );
  expect(metadata.deadAir.some((span) => span.end - span.start >= 100)).toBe(true);
});

test("pre-action attached waits honor action timeout", async ({ page }, testInfo) => {
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [videoMode({ finalHold: 50, highlight: { mode: "pointer", duration: 20 } })],
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
  const video = videoMode({ finalHold: 50, highlight: { mode: "pointer", duration: 20 } });
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

  expect((await video.metadata()).deadAir.some((span) => span.end - span.start >= 100)).toBe(true);
});

test("marks default visible waitFor calls as dead air", async ({ page }, testInfo) => {
  const video = videoMode({ finalHold: 50, highlight: { mode: "pointer", duration: 20 } });
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [video],
  });
  await plugged.setContent(`
    <div id="ready" style="display: none;">ready</div>
    <script>
      setTimeout(() => {
        document.querySelector('#ready').style.display = 'block';
      }, 150);
    </script>
  `);

  await plugged.locator("#ready").waitFor();

  expect((await video.metadata()).deadAir.some((span) => span.end - span.start >= 100)).toBe(true);
});

test("marks explicit visible waitFor calls as dead air", async ({ page }, testInfo) => {
  const video = videoMode({ finalHold: 50, highlight: { mode: "pointer", duration: 20 } });
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [video],
  });
  await plugged.setContent(`
    <script>
      setTimeout(() => {
        document.body.insertAdjacentHTML('beforeend', '<div id="late">visible</div>');
      }, 150);
    </script>
  `);

  await plugged.locator("#late").waitFor({ state: "visible" });

  expect((await video.metadata()).deadAir.some((span) => span.end - span.start >= 100)).toBe(true);
});

test("marks attached actionability waits as dead air", async ({ page }, testInfo) => {
  const video = videoMode({ finalHold: 50, highlight: { mode: "pointer", duration: 20 } });
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [video],
  });
  await plugged.setContent(`
    <button id="ready" style="display: none;">ready</button>
    <div id="result"></div>
    <script>
      setTimeout(() => {
        document.querySelector('#ready').style.display = 'block';
      }, 150);
      document.querySelector('#ready').addEventListener('click', () => {
        document.querySelector('#result').textContent = 'clicked';
      });
    </script>
  `);

  await plugged.locator("#ready").click();

  await expect(plugged.locator("#result")).toContainText("clicked");
  expect((await video.metadata()).deadAir.some((span) => span.end - span.start >= 100)).toBe(true);
});

test("sets video source range from current timestamps", async ({ page }, testInfo) => {
  const video = videoMode({ finalHold: 50, highlight: { mode: "pointer", duration: 20 } });
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [video],
  });

  const startBefore = plugged.videoMode.getVideoTimestamp();
  plugged.videoMode.setStartTime();
  const startAfter = plugged.videoMode.getVideoTimestamp();
  await plugged.waitForTimeout(20);
  const endBefore = plugged.videoMode.getVideoTimestamp();
  plugged.videoMode.setEndTime();
  const endAfter = plugged.videoMode.getVideoTimestamp();

  const metadata = await plugged.videoMode.metadata();
  expect(metadata).toMatchObject({
    sourceRange: {
      end: expect.any(Number),
      start: expect.any(Number),
    },
  });
  expect(metadata.sourceRange.start).toBeGreaterThanOrEqual(startBefore);
  expect(metadata.sourceRange.start).toBeLessThanOrEqual(startAfter);
  expect(metadata.sourceRange.end).toBeGreaterThanOrEqual(endBefore);
  expect(metadata.sourceRange.end).toBeLessThanOrEqual(endAfter);
});

test("deadAir runs actions without video highlighting and records metadata", async ({
  page,
}, testInfo) => {
  const video = videoMode({ finalHold: 50, highlight: { mode: "pointer", duration: 5000 } });
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
    const videoTimestamp = plugged.videoMode.getVideoTimestamp();
    await plugged.videoMode.deadAir(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await plugged.locator("#btn").click();
    });

    expect(Date.now() - start).toBeLessThan(2000);
    expect(plugged.videoMode.getVideoTimestamp()).toBeGreaterThanOrEqual(videoTimestamp);
    await expect(plugged.locator("#result")).toContainText("(no style)");
    await expect(plugged.videoMode.metadata()).resolves.toMatchObject({
      outputs: {},
      schemaVersion: 1,
      timebase: "ms",
    });
    expect((await plugged.videoMode.metadata()).deadAir).toContainEqual(
      expect.objectContaining({ end: expect.any(Number), start: expect.any(Number) }),
    );
    expect((await plugged.videoMode.metadata()).highlights).toEqual([]);
  }

  const paths = video.outputPaths();
  expect(paths.metadata).toBe(join(testInfo.outputDir, "video-mode.json"));
  expect(paths.player).toBe(join(testInfo.outputDir, "video-mode.html"));
  expect(paths.raw).toBe(join(testInfo.outputDir, "video-raw.webm"));
  expect(paths.rendered).toBe(join(testInfo.outputDir, "video-rendered.webm"));
  expect(paths.reportPlayer).toBe(join(testInfo.outputDir, "video-mode-report.html"));

  const metadata = await video.metadata();
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
