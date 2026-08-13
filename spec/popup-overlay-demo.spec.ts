// Demo-grade popup flow with the full watchable treatment — pointer
// highlights, step captions, address bar, popup overlay composite. The
// rendered output doubles as the PR/README demo video.
import { stat } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { addPlugins, videoMode } from "../src/index.ts";
import { routeAuthDemoApp } from "./auth-demo-app.ts";

test.use({ video: "on", viewport: { width: 960, height: 540 } });

test("auth popup demo", async ({ page: basePage, context }, testInfo) => {
  await routeAuthDemoApp(context);
  const video = videoMode();
  {
    await using page = await addPlugins({ page: basePage, testInfo, plugins: [video] });

    const popupPromise = basePage.waitForEvent("popup");
    await test.step("Open the sign-in popup", async () => {
      await page.goto("https://app.middlewright.test/");
      // Real frames on each side of the popup span keep the composite honest
      // (and the demo watchable) — an instant flow would land before the
      // screencast's first frame.
      await page.waitForTimeout(500);
      await page.getByRole("button", { name: "Sign in" }).click();
    });

    const popup = await popupPromise;
    await test.step("Approve access in the popup", async () => {
      await popup.waitForTimeout(500);
      await popup.getByRole("button", { name: "Approve" }).click();
    });

    await test.step("Back on the app, signed in", async () => {
      await page.getByText("Signed in as mmkal").waitFor();
      await page.waitForTimeout(500);
    });
  }

  const metadata = await video.metadata();
  expect(metadata).toMatchObject({
    children: [{ closedAt: expect.any(Number), openedAt: expect.any(Number) }],
    outputs: { raw: "video-raw.webm", rendered: "video-rendered.webm" },
  });
  expect(metadata.children[0].closedAt!).toBeGreaterThan(metadata.children[0].openedAt);
  expect((await stat(video.outputPaths().rendered)).size).toBeGreaterThan(0);
});
