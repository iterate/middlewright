import { stat } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { addPlugins, videoMode } from "../src/index.ts";
import { routeAuthDemoApp } from "./auth-demo-app.ts";

test.use({ video: "on" });

test("captures an auto-wrapped popup's raw screencast for the composite", async ({
  page: basePage,
  context,
}, testInfo) => {
  await routeAuthDemoApp(context);
  const video = videoMode({ finalHold: 0, highlight: { mode: "outline", duration: 300 }, trimStart: "never" });
  {
    await using page = await addPlugins({ page: basePage, testInfo, plugins: [video] });
    await page.goto("https://app.middlewright.test/");

    const popupPromise = basePage.waitForEvent("popup");
    await page.getByRole("button", { name: "Sign in" }).click();
    await (await popupPromise).getByRole("button", { name: "Approve" }).click();
    await page.getByText("Signed in as mmkal").waitFor();
  }

  const metadata = await video.metadata();
  expect(metadata.children).toMatchObject([
    {
      closedAt: expect.any(Number),
      highlights: [{ method: "click" }],
      openedAt: expect.any(Number),
      raw: "video-raw-popup-1.webm",
      recordingEndedAt: expect.any(Number),
      viewport: { height: expect.any(Number), width: expect.any(Number) },
    },
  ]);
  const [child] = metadata.children;
  expect(child.closedAt!).toBeGreaterThan(child.openedAt);
  expect((await stat(join(testInfo.outputDir, child.raw!))).size).toBeGreaterThan(0);
});

test("records separate videos for the main page and an auth popup", async ({
  page: basePage,
  context,
}, testInfo) => {
  await routeAuthDemoApp(context);
  const video = videoMode({ finalHold: 0, highlight: { mode: "outline", duration: 300 }, trimStart: "never" });
  let popupVideo!: ReturnType<typeof videoMode>;
  {
    await using page = await addPlugins({ page: basePage, testInfo, plugins: [video], popups: false });
    await page.goto("https://app.middlewright.test/");

    const popupPromise = basePage.waitForEvent("popup");
    await page.getByRole("button", { name: "Sign in" }).click();
    popupVideo = videoMode({ finalHold: 0, highlight: { mode: "outline", duration: 300 }, trimStart: "never" });
    await using popup = await addPlugins({
      page: await popupPromise,
      testInfo,
      plugins: [popupVideo],
    });

    await popup.getByRole("button", { name: "Approve" }).click();
    await page.getByText("Signed in as mmkal").waitFor();
  }

  // Playwright screencasts each page separately, so each instance ends the
  // test with its own raw recording and its own annotated render.
  await expect(video.metadata()).resolves.toMatchObject({
    outputs: { raw: "video-raw.webm", rendered: "video-rendered.webm" },
  });
  await expect(popupVideo.metadata()).resolves.toMatchObject({
    outputs: { raw: "video-raw-2.webm", rendered: "video-rendered-2.webm" },
  });
  for (const path of [
    video.outputPaths().raw,
    video.outputPaths().rendered,
    popupVideo.outputPaths().raw,
    popupVideo.outputPaths().rendered,
  ]) {
    expect((await stat(path)).size).toBeGreaterThan(0);
  }
});
