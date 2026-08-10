import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { addPlugins, videoMode } from "../src/index.ts";

test("records goto destinations without changing the live page", async ({
  page: basePage,
}, testInfo) => {
  const destination = "https://app.middlewright.test/reports?period=this-week";
  await basePage.route(destination, async (route) => {
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
  await using page = await addPlugins({
    page: basePage,
    testInfo,
    plugins: [video],
  });

  const startedAt = performance.now();
  await page.goto(destination);

  expect(performance.now() - startedAt).toBeLessThan(2000);
  await basePage.waitForSelector('main:has-text("Weekly reports")');
  expect(await page.evaluate(() => (window as any).addressBarEnteredPage)).toBe(false);
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
  page: basePage,
}, testInfo) => {
  const video = videoMode({
    finalHold: 0,
    highlight: { mode: "outline", duration: 300 },
    trimStart: "never",
  });
  await using page = await addPlugins({
    page: basePage,
    testInfo,
    plugins: [video],
  });
  await page.setContent(`
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

  await page.getByLabel("Search").fill("middlewright");

  await basePage.waitForSelector('output:has-text("middlewright")');
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

test("records Playwright test steps as captions by default", async ({ page: basePage }, testInfo) => {
  const video = videoMode({ finalHold: 0, highlight: false });
  await using page = await addPlugins({
    page: basePage,
    testInfo,
    plugins: [video],
  });

  await test.step("Create an account", async () => {
    await page.setContent("<button>Create</button>");
    await page.getByText("Create").click();
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

test("records only explicit captions when configured", async ({ page: basePage }, testInfo) => {
  const video = videoMode({
    captions: "explicit",
    finalHold: 0,
    highlight: false,
  });
  await using page = await addPlugins({
    page: basePage,
    testInfo,
    plugins: [video],
  });

  const result = await test.step("Ignored Playwright step", async () => {
    return await page.videoMode.caption("Create an account", async () => {
      await page.setContent("<button>Create</button>");
      await page.getByText("Create").click();
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

test("shows the innermost caption and resumes its parent", async ({ page: basePage }, testInfo) => {
  const video = videoMode({
    captions: "explicit",
    finalHold: 0,
    highlight: false,
  });
  await using page = await addPlugins({
    page: basePage,
    testInfo,
    plugins: [video],
  });

  await page.videoMode.caption("Create an account", async () => {
    await page.waitForTimeout(10);
    await page.videoMode.caption("Choose a plan", async () => {
      await page.waitForTimeout(10);
    });
    await page.waitForTimeout(10);
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
  page: basePage,
}, testInfo) => {
  await using page = await addPlugins({
    page: basePage,
    testInfo,
    plugins: [videoMode({ finalHold: 50, highlight: { mode: "pointer", duration: 300 } })],
  });
  await page.setContent(`
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
  await page.locator("#btn").click();

  expect(Date.now() - start).toBeLessThan(1000);
  await basePage.waitForSelector('#result:has-text("(no style)")');
  await expect(page.videoMode.metadata()).resolves.toMatchObject({
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
  page: basePage,
}, testInfo) => {
  const video = videoMode({
    finalHold: 0,
    highlight: { mode: "pointer", duration: 300 },
    trimStart: "never",
  });
  await using page = await addPlugins({
    page: basePage,
    testInfo,
    plugins: [video],
  });
  await page.setContent(`
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
  page.once("dialog", (dialog) => dialog.accept());

  await page.locator("#discard").click();

  await basePage.waitForSelector('#result:has-text("discarded")');
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

test("records prompt entry before the accepted prompt decision", async ({ page: basePage }, testInfo) => {
  const video = videoMode({
    finalHold: 0,
    highlight: { mode: "pointer", duration: 300 },
    trimStart: "never",
  });
  await using page = await addPlugins({
    page: basePage,
    testInfo,
    plugins: [video],
  });
  await page.setContent(`
    <button id="rename">Rename file</button>
    <output id="result"></output>
    <script>
      document.querySelector("#rename").addEventListener("click", () => {
        document.querySelector("#result").textContent = prompt("New file name", "draft.md") || "cancelled";
      });
    </script>
  `);
  page.once("dialog", (dialog) => dialog.accept("release-notes.md"));

  await page.locator("#rename").click();

  await basePage.waitForSelector('#result:has-text("release-notes.md")');
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
  page: basePage,
}, testInfo) => {
  const video = videoMode({
    finalHold: 0,
    highlight: { mode: "pointer", duration: 300 },
    trimStart: "never",
  });
  await using page = await addPlugins({
    page: basePage,
    testInfo,
    plugins: [video],
  });
  await page.setContent(`
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
  page.once("dialog", (dialog) => dialog.accept(""));

  await page.locator("#rename").click();

  await basePage.waitForSelector('#result:has-text(\'""\')');
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

test("preserves Playwright's automatic dialog dismissal", async ({ page: basePage }, testInfo) => {
  const video = videoMode({
    finalHold: 0,
    highlight: { mode: "pointer", duration: 300 },
    trimStart: "never",
  });
  await using page = await addPlugins({
    page: basePage,
    testInfo,
    plugins: [video],
  });
  await page.setContent(`
    <button id="discard">Discard file</button>
    <output id="result"></output>
    <script>
      document.querySelector("#discard").addEventListener("click", () => {
        document.querySelector("#result").textContent = confirm("Discard changes?") ? "discarded" : "kept";
      });
    </script>
  `);

  await page.locator("#discard").click();

  await basePage.waitForSelector('#result:has-text("kept")');
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

test("records an alert acknowledgement", async ({ page: basePage }, testInfo) => {
  const video = videoMode({
    finalHold: 0,
    highlight: { mode: "pointer", duration: 300 },
    trimStart: "never",
  });
  await using page = await addPlugins({
    page: basePage,
    testInfo,
    plugins: [video],
  });
  await page.setContent(`
    <button id="publish">Publish</button>
    <output id="result"></output>
    <script>
      document.querySelector("#publish").addEventListener("click", () => {
        alert("Release published");
        document.querySelector("#result").textContent = "done";
      });
    </script>
  `);
  page.once("dialog", (dialog) => dialog.accept());

  await page.locator("#publish").click();

  await basePage.waitForSelector('#result:has-text("done")');
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

test("records automatic alert dismissal as an OK acknowledgement", async ({ page: basePage }, testInfo) => {
  const video = videoMode({
    finalHold: 0,
    highlight: { mode: "pointer", duration: 300 },
    trimStart: "never",
  });
  await using page = await addPlugins({
    page: basePage,
    testInfo,
    plugins: [video],
  });
  await page.setContent(`
    <button id="publish">Publish</button>
    <output id="result"></output>
    <script>
      document.querySelector("#publish").addEventListener("click", () => {
        alert("Release published");
        document.querySelector("#result").textContent = "acknowledged";
      });
    </script>
  `);

  await page.locator("#publish").click();

  await basePage.waitForSelector('#result:has-text("acknowledged")');
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
  page: basePage,
}, testInfo) => {
  basePage.once("dialog", (dialog) => dialog.accept());
  const video = videoMode({
    finalHold: 0,
    highlight: { mode: "pointer", duration: 300 },
    trimStart: "never",
  });
  await using page = await addPlugins({
    page: basePage,
    testInfo,
    plugins: [video],
  });
  await page.setContent(`
    <button id="continue">Continue</button>
    <output id="result"></output>
    <script>
      document.querySelector("#continue").addEventListener("click", () => {
        document.querySelector("#result").textContent = confirm("Continue?") ? "yes" : "no";
      });
    </script>
  `);

  await page.locator("#continue").click();

  await basePage.waitForSelector('#result:has-text("yes")');
  expect((await video.metadata()).highlights).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        dialog: expect.objectContaining({ message: "Continue?" }),
      }),
    ]),
  );
});

test("records back-to-back dialogs in order", async ({ page: basePage }, testInfo) => {
  const video = videoMode({
    finalHold: 0,
    highlight: { mode: "pointer", duration: 300 },
    trimStart: "never",
  });
  await using page = await addPlugins({
    page: basePage,
    testInfo,
    plugins: [video],
  });
  await page.setContent(`
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
  page.on("dialog", (dialog) => void dialog.accept());

  await page.locator("#discard").click();

  await basePage.waitForSelector('#result:has-text("discarded")');
  const dialogHighlights = (await video.metadata()).highlights.filter(
    (highlight) => highlight.dialog,
  );
  expect(dialogHighlights).toMatchObject([
    { dialog: { action: "accept", message: "Discard unsaved changes?", type: "confirm" } },
    { dialog: { action: "accept", message: "Really discard this file?", type: "confirm" } },
  ]);
  expect(dialogHighlights.map((highlight) => highlight.image)).toEqual([undefined, undefined]);
});

test("skipped methods are not highlighted", async ({ page: basePage }, testInfo) => {
  const video = videoMode({
    finalHold: 50,
    highlight: { mode: "pointer", duration: 5000 },
    skipMethods: ["click"],
  });
  await using page = await addPlugins({
    page: basePage,
    testInfo,
    plugins: [video],
  });
  await page.setContent(`
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
  await page.locator("#btn").click();
  expect(Date.now() - start).toBeLessThan(2000);
  const metadata = await video.metadata();
  expect(metadata.deadAir.some((span) => span.end - span.start >= 100)).toBe(true);
  expect(metadata.highlights).toEqual([]);
});

test("waitFor highlighting can be skipped explicitly", async ({ page: basePage }, testInfo) => {
  const video = videoMode({
    finalHold: 50,
    highlight: { mode: "pointer", duration: 5000 },
    skipMethods: ["waitFor"],
  });
  await using page = await addPlugins({
    page: basePage,
    testInfo,
    plugins: [video],
  });
  await page.setContent(`
    <div id="ready" hidden>ready</div>
    <script>
      setTimeout(() => {
        document.querySelector('#ready').hidden = false;
      }, 150);
    </script>
  `);

  const start = Date.now();
  await page.locator("#ready").waitFor();

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
      // The destination centers the element, matching Chromium's own
      // scroll-for-action alignment: element center minus half a viewport.
      to: { x: 2000 + 100 - 400, y: 0 },
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

test("marks pre-action waits for attachment as dead air", async ({ page: basePage }, testInfo) => {
  const video = videoMode({ finalHold: 50, highlight: { mode: "pointer", duration: 20 } });
  await using page = await addPlugins({
    page: basePage,
    testInfo,
    plugins: [video],
  });
  await page.setContent(`
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

  await page.locator("#late").click();

  await basePage.waitForSelector('#result:has-text("clicked")');
  const metadata = await video.metadata();
  expect(metadata.deadAir).toContainEqual(
    expect.objectContaining({
      end: expect.any(Number),
      start: expect.any(Number),
    }),
  );
  expect(metadata.deadAir.some((span) => span.end - span.start >= 100)).toBe(true);
});

test("pre-action attached waits honor action timeout", async ({ page: basePage }, testInfo) => {
  await using page = await addPlugins({
    page: basePage,
    testInfo,
    plugins: [videoMode({ finalHold: 50, highlight: { mode: "pointer", duration: 20 } })],
  });
  await page.setContent(`
    <script>
      setTimeout(() => {
        document.body.insertAdjacentHTML('beforeend', '<button id="late">late</button>');
      }, 300);
    </script>
  `);

  const start = Date.now();
  // timeout tests this failure budget; spinner waiter is absent to isolate video mode.
  const error = await page.locator("#late").click({ timeout: 100 }).catch((e: Error) => e);

  expect(Date.now() - start).toBeLessThan(250);
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).toContain("Timeout 100ms exceeded");
});

test("marks explicit attached waitFor calls as dead air", async ({ page: basePage }, testInfo) => {
  const video = videoMode({ finalHold: 50, highlight: { mode: "pointer", duration: 20 } });
  await using page = await addPlugins({
    page: basePage,
    testInfo,
    plugins: [video],
  });
  await page.setContent(`
    <script>
      setTimeout(() => {
        document.body.insertAdjacentHTML('beforeend', '<div id="late">attached</div>');
      }, 150);
    </script>
  `);

  await page.locator("#late").waitFor({ state: "attached" });

  expect((await video.metadata()).deadAir.some((span) => span.end - span.start >= 100)).toBe(true);
});

test("marks default visible waitFor calls as dead air", async ({ page: basePage }, testInfo) => {
  const video = videoMode({ finalHold: 50 });
  await using page = await addPlugins({
    page: basePage,
    testInfo,
    plugins: [video],
  });
  await page.setContent(`
    <div id="ready" hidden>ready</div>
    <script>
      setTimeout(() => {
        document.querySelector('#ready').hidden = false;
      }, 150);
    </script>
  `);

  await page.locator("#ready").waitFor();

  const metadata = await video.metadata();
  expect(metadata.deadAir.some((span) => span.end - span.start >= 100)).toBe(true);
  expect(metadata.highlights).toMatchObject([{ method: "waitFor" }]);
  expect(metadata.highlights[0].end - metadata.highlights[0].start).toBe(1000);
});

test("marks explicit visible waitFor calls as dead air", async ({ page: basePage }, testInfo) => {
  const video = videoMode({ finalHold: 50, highlight: { mode: "pointer", duration: 20 } });
  await using page = await addPlugins({
    page: basePage,
    testInfo,
    plugins: [video],
  });
  await page.setContent(`
    <script>
      setTimeout(() => {
        document.body.insertAdjacentHTML('beforeend', '<div id="late">visible</div>');
      }, 150);
    </script>
  `);

  await page.locator("#late").waitFor({ state: "visible" });

  expect((await video.metadata()).deadAir.some((span) => span.end - span.start >= 100)).toBe(true);
});

test("does not highlight a waitFor result that is no longer visible", async ({ page: basePage }, testInfo) => {
  const video = videoMode({ finalHold: 50, highlight: { mode: "pointer", duration: 20 } });
  await using page = await addPlugins({
    page: basePage,
    testInfo,
    plugins: [video],
  });
  await page.setContent(`
    <div id="notice" style="width: 200px; height: 80px">Temporary notice</div>
    <script>
      setTimeout(() => {
        document.querySelector('#notice').style.visibility = 'hidden';
      }, 150);
    </script>
  `);

  await page.locator("#notice").waitFor({ state: "hidden" });

  const metadata = await video.metadata();
  expect(metadata.deadAir.some((span) => span.end - span.start >= 100)).toBe(true);
  expect(metadata.highlights).toEqual([]);
});

test("marks attached actionability waits as dead air", async ({ page: basePage }, testInfo) => {
  const video = videoMode({ finalHold: 50, highlight: { mode: "pointer", duration: 20 } });
  await using page = await addPlugins({
    page: basePage,
    testInfo,
    plugins: [video],
  });
  await page.setContent(`
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

  await page.locator("#ready").click();

  await basePage.waitForSelector('#result:has-text("clicked")');
  expect((await video.metadata()).deadAir.some((span) => span.end - span.start >= 100)).toBe(true);
});

test("sets video source range from current timestamps", async ({ page: basePage }, testInfo) => {
  const video = videoMode({ finalHold: 50, highlight: { mode: "pointer", duration: 20 } });
  await using page = await addPlugins({
    page: basePage,
    testInfo,
    plugins: [video],
  });

  const startBefore = page.videoMode.getVideoTimestamp();
  page.videoMode.setStartTime();
  const startAfter = page.videoMode.getVideoTimestamp();
  await page.setContent(`<button>first locator action</button>`);
  await page.locator("button").click();
  await page.waitForTimeout(20);
  const endBefore = page.videoMode.getVideoTimestamp();
  page.videoMode.setEndTime();
  const endAfter = page.videoMode.getVideoTimestamp();

  const metadata = await page.videoMode.metadata();
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
  page: basePage,
}, testInfo) => {
  const video = videoMode({ finalHold: 50, highlight: { mode: "pointer", duration: 5000 } });
  {
    await using page = await addPlugins({
      page: basePage,
      testInfo,
      plugins: [video],
    });

    await page.setContent(`
      <button id="btn">press</button>
      <div id="result"></div>
      <script>
        document.getElementById('btn').addEventListener('click', function () {
          document.getElementById('result').textContent = this.getAttribute('style') || '(no style)';
        });
      </script>
    `);

    const start = Date.now();
    const videoTimestamp = page.videoMode.getVideoTimestamp();
    await page.videoMode.deadAir(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await page.locator("#btn").click();
    });

    expect(Date.now() - start).toBeLessThan(2000);
    expect(page.videoMode.getVideoTimestamp()).toBeGreaterThanOrEqual(videoTimestamp);
    await basePage.waitForSelector('#result:has-text("(no style)")');
    await expect(page.videoMode.metadata()).resolves.toMatchObject({
      outputs: {},
      schemaVersion: 1,
      timebase: "ms",
    });
    expect((await page.videoMode.metadata()).deadAir).toContainEqual(
      expect.objectContaining({ end: expect.any(Number), start: expect.any(Number) }),
    );
    expect((await page.videoMode.metadata()).highlights).toEqual([]);
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
