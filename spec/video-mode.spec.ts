import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { addPlugins, videoMode } from "../src/index.ts";

test("records goto destinations without changing the live page", async ({
  page,
}, testInfo) => {
  const destination = "https://app.middlewright.test/reports?period=this-week";
  await page.route(destination, async (route) => {
    await route.fulfill({
      body: `
        <main>Weekly reports</main>
        <script>
          window.addressBarEnteredPage = false;
          new MutationObserver(() => {
            if (document.querySelector('[data-middlewright-video-mode-address-bar]')) {
              window.addressBarEnteredPage = true;
            }
          }).observe(document.documentElement, { childList: true, subtree: true });
        </script>
      `,
      contentType: "text/html",
    });
  });
  const video = videoMode({
    addressBar: { holdMs: 5000 },
    finalHold: 0,
    highlight: false,
  });
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [video],
  });

  const startedAt = performance.now();
  await plugged.goto(destination);

  expect(performance.now() - startedAt).toBeLessThan(2000);
  await expect(plugged.getByRole("main")).toHaveText("Weekly reports");
  expect(await plugged.evaluate(() => (window as any).addressBarEnteredPage)).toBe(false);
  await expect(video.metadata()).resolves.toMatchObject({
    addressBars: [
      {
        end: expect.any(Number),
        start: expect.any(Number),
        url: destination,
      },
    ],
  });
});

test("keeps a successful fill when its reveal target disappears", async ({
  page,
}, testInfo) => {
  const video = videoMode({
    finalHold: 0,
    highlight: { mode: "outline", duration: 300 },
    trimStart: "never",
  });
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [video],
  });
  await plugged.setContent(`
    <input aria-label="Search" />
    <output></output>
    <script>
      const input = document.querySelector("input");
      input.addEventListener("input", () => {
        document.querySelector("output").textContent = input.value;
        input.remove();
      });
    </script>
  `);

  await plugged.getByLabel("Search").fill("middlewright");

  await expect(plugged.locator("output")).toHaveText("middlewright");
  const metadata = await video.metadata();
  expect(metadata).toMatchObject({
    highlights: [
      {
        method: "fill",
      },
    ],
  });
  expect(metadata.highlights[0]).not.toHaveProperty("fillReveal");
});

test("records Playwright test steps as captions by default", async ({ page }, testInfo) => {
  const video = videoMode({ finalHold: 0, highlight: false });
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [video],
  });

  await test.step("Create an account", async () => {
    await plugged.setContent("<button>Create</button>");
    await plugged.getByText("Create").click();
  });

  await expect(video.metadata()).resolves.toMatchObject({
    captions: [
      {
        end: expect.any(Number),
        start: expect.any(Number),
        text: "Create an account",
      },
    ],
  });
  expect((await video.metadata()).captions[0].end).toBeGreaterThan(
    (await video.metadata()).captions[0].start,
  );
});

test("records only explicit captions when configured", async ({ page }, testInfo) => {
  const video = videoMode({
    captions: "explicit",
    finalHold: 0,
    highlight: false,
  });
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [video],
  });

  const result = await test.step("Ignored Playwright step", async () => {
    return await plugged.videoMode.caption("Create an account", async () => {
      await plugged.setContent("<button>Create</button>");
      await plugged.getByText("Create").click();
      return "created";
    });
  });

  expect(result).toBe("created");
  await expect(video.metadata()).resolves.toMatchObject({
    captions: [
      {
        end: expect.any(Number),
        start: expect.any(Number),
        text: "Create an account",
      },
    ],
  });
});

test("shows the innermost caption and resumes its parent", async ({ page }, testInfo) => {
  const video = videoMode({
    captions: "explicit",
    finalHold: 0,
    highlight: false,
  });
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [video],
  });

  await plugged.videoMode.caption("Create an account", async () => {
    await plugged.waitForTimeout(10);
    await plugged.videoMode.caption("Choose a plan", async () => {
      await plugged.waitForTimeout(10);
    });
    await plugged.waitForTimeout(10);
  });

  const captions = (await video.metadata()).captions;
  expect(captions.map((caption) => caption.text)).toEqual([
    "Create an account",
    "Choose a plan",
    "Create an account",
  ]);
  expect(captions[0].end).toBe(captions[1].start);
  expect(captions[1].end).toBe(captions[2].start);
});

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
  const metadata = await video.metadata();
  const dialogHighlights = metadata.highlights.filter(
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
      method: "fill",
    },
    {
      dialog: {
        action: "accept",
        message: "New file name",
        promptText: "release-notes.md",
        type: "prompt",
      },
      method: "click",
    },
  ]);
  expect(metadata.highlights.map((highlight) => highlight.method)).toEqual([
    "click",
    "fill",
    "click",
  ]);
});

test("records an explicit empty prompt response separately from its default", async ({
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
    <button id="rename">Rename file</button>
    <output id="result"></output>
    <script>
      document.querySelector("#rename").addEventListener("click", () => {
        document.querySelector("#result").textContent = JSON.stringify(
          prompt("New file name", "draft-👩🏽‍💻.md"),
        );
      });
    </script>
  `);
  plugged.once("dialog", (dialog) => dialog.accept(""));

  await plugged.locator("#rename").click();

  await expect(plugged.locator("#result")).toHaveText('""');
  const dialogHighlights = (await video.metadata()).highlights.filter(
    (candidate) => candidate.dialog?.type === "prompt",
  );
  expect(dialogHighlights).toMatchObject([
    {
      dialog: {
        action: "accept",
        defaultValue: "draft-👩🏽‍💻.md",
        message: "New file name",
        promptText: "",
        type: "prompt",
      },
      method: "fill",
    },
    {
      dialog: {
        action: "accept",
        defaultValue: "draft-👩🏽‍💻.md",
        message: "New file name",
        promptText: "",
        type: "prompt",
      },
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

test("records automatic alert dismissal as an OK acknowledgement", async ({ page }, testInfo) => {
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
        document.querySelector("#result").textContent = "acknowledged";
      });
    </script>
  `);

  await plugged.locator("#publish").click();

  await expect(plugged.locator("#result")).toHaveText("acknowledged");
  await expect(video.metadata()).resolves.toMatchObject({
    highlights: expect.arrayContaining([
      expect.objectContaining({
        dialog: {
          action: "accept",
          message: "Release published",
          type: "alert",
        },
      }),
    ]),
  });
});

test("records dialogs handled by a listener registered before video mode", async ({
  page,
}, testInfo) => {
  page.once("dialog", (dialog) => dialog.accept());
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
    <button id="continue">Continue</button>
    <output id="result"></output>
    <script>
      document.querySelector("#continue").addEventListener("click", () => {
        document.querySelector("#result").textContent = confirm("Continue?") ? "yes" : "no";
      });
    </script>
  `);

  await plugged.locator("#continue").click();

  await expect(plugged.locator("#result")).toHaveText("yes");
  expect((await video.metadata()).highlights).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        dialog: expect.objectContaining({ message: "Continue?" }),
      }),
    ]),
  );
});

test("records back-to-back dialogs in order", async ({ page }, testInfo) => {
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
        const discarded = confirm("Discard unsaved changes?");
        const confirmed = confirm("Really discard this file?");
        document.querySelector("#result").textContent = discarded && confirmed
          ? "discarded"
          : "kept";
      });
    </script>
  `);
  plugged.on("dialog", (dialog) => void dialog.accept());

  await plugged.locator("#discard").click();

  await expect(plugged.locator("#result")).toHaveText("discarded");
  const dialogHighlights = (await video.metadata()).highlights.filter(
    (highlight) => highlight.dialog,
  );
  expect(dialogHighlights).toMatchObject([
    { dialog: { action: "accept", message: "Discard unsaved changes?", type: "confirm" } },
    { dialog: { action: "accept", message: "Really discard this file?", type: "confirm" } },
  ]);
  expect(dialogHighlights.map((highlight) => highlight.image)).toEqual([undefined, undefined]);
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

test("waitFor highlighting can be skipped explicitly", async ({ page }, testInfo) => {
  const video = videoMode({
    finalHold: 50,
    highlight: { mode: "pointer", duration: 5000 },
    skipMethods: ["waitFor"],
  });
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [video],
  });
  await plugged.setContent(`
    <div id="ready" hidden>ready</div>
    <script>
      setTimeout(() => {
        document.querySelector('#ready').hidden = false;
      }, 150);
    </script>
  `);

  const start = Date.now();
  await plugged.locator("#ready").waitFor();

  expect(Date.now() - start).toBeLessThan(2000);
  const metadata = await video.metadata();
  expect(metadata.deadAir.some((span) => span.end - span.start >= 100)).toBe(true);
  expect(metadata.highlights).toEqual([]);
});

test("records a horizontal pan for a waitFor target beyond the right edge", async ({
  page,
}, testInfo) => {
  const video = videoMode({ finalHold: 0 });
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [video],
  });
  await plugged.setViewportSize({ width: 800, height: 600 });
  await plugged.setContent(`
    <div style="width: 3000px; height: 100px">
      <div id="wide" style="position: absolute; left: 2000px; top: 40px; width: 200px; height: 50px; background: teal"></div>
    </div>
  `);

  await plugged.locator("#wide").waitFor();

  expect(await page.evaluate(() => window.scrollX)).toBe(0);
  const metadata = await video.metadata();
  const [highlight] = metadata.highlights;
  expect(highlight).toMatchObject({
    method: "waitFor",
    pan: {
      back: true,
      from: { x: 0, y: 0 },
      to: { x: 2000 + 200 + 24 - 800, y: 0 },
    },
  });
  // The held rect is viewport-relative at the panned-to position.
  expect(highlight.rect.x + highlight.rect.width).toBeLessThanOrEqual(800);
  expect(highlight.rect.x).toBeGreaterThanOrEqual(0);
});

test("keeps plain highlighting for a target clipped by an inner scroll container", async ({
  page,
}, testInfo) => {
  const video = videoMode({ finalHold: 0 });
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [video],
  });
  await plugged.setViewportSize({ width: 800, height: 600 });
  await plugged.setContent(`
    <div style="height: 200px; overflow: auto; position: relative">
      <div style="height: 900px">
        <div id="buried" style="position: absolute; left: 20px; top: 700px; width: 200px; height: 50px; background: teal"></div>
      </div>
    </div>
  `);

  await plugged.locator("#buried").waitFor();

  // Scrolling the window cannot reveal this element, so no pan is fabricated
  // and the offscreen rect is recorded as before.
  const metadata = await video.metadata();
  const [highlight] = metadata.highlights;
  // 708 = 700 within the container plus the default body margin.
  expect(highlight).toMatchObject({ method: "waitFor", rect: { y: 708 } });
  expect(highlight.pan).toBeUndefined();
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
  const video = videoMode({ finalHold: 50 });
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [video],
  });
  await plugged.setContent(`
    <div id="ready" hidden>ready</div>
    <script>
      setTimeout(() => {
        document.querySelector('#ready').hidden = false;
      }, 150);
    </script>
  `);

  await plugged.locator("#ready").waitFor();

  const metadata = await video.metadata();
  expect(metadata.deadAir.some((span) => span.end - span.start >= 100)).toBe(true);
  expect(metadata.highlights).toMatchObject([{ method: "waitFor" }]);
  expect(metadata.highlights[0].end - metadata.highlights[0].start).toBe(1000);
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

test("does not highlight a waitFor result that is no longer visible", async ({ page }, testInfo) => {
  const video = videoMode({ finalHold: 50, highlight: { mode: "pointer", duration: 20 } });
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [video],
  });
  await plugged.setContent(`
    <div id="notice" style="width: 200px; height: 80px">Temporary notice</div>
    <script>
      setTimeout(() => {
        document.querySelector('#notice').style.visibility = 'hidden';
      }, 150);
    </script>
  `);

  await plugged.locator("#notice").waitFor({ state: "hidden" });

  const metadata = await video.metadata();
  expect(metadata.deadAir.some((span) => span.end - span.start >= 100)).toBe(true);
  expect(metadata.highlights).toEqual([]);
});

test("marks attached actionability waits as dead air", async ({ page }, testInfo) => {
  const video = videoMode({ finalHold: 50, highlight: { mode: "pointer", duration: 20 } });
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [video],
  });
  await plugged.setContent(`
    <button id="ready" hidden>ready</button>
    <div id="result"></div>
    <script>
      setTimeout(() => {
        document.querySelector('#ready').hidden = false;
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
  await plugged.setContent(`<button>first locator action</button>`);
  await plugged.locator("button").click();
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
