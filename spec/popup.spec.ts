import { test, expect } from "@playwright/test";
import { addPlugins, videoMode } from "../src/index.ts";
import { routeAuthDemoApp } from "./auth-demo-app.ts";

test("a popup wrapped with addPlugins runs actions through its own plugins", async ({
  page: basePage,
  context,
}, testInfo) => {
  await routeAuthDemoApp(context);
  const video = videoMode({ finalHold: 0, highlight: { mode: "outline", duration: 300 }, trimStart: "never" });
  await using page = await addPlugins({ page: basePage, testInfo, plugins: [video] });
  await page.goto("https://app.middlewright.test/");

  const popupPromise = basePage.waitForEvent("popup");
  await page.getByRole("button", { name: "Sign in" }).click();
  const popupVideo = videoMode({ finalHold: 0, highlight: { mode: "outline", duration: 300 }, trimStart: "never" });
  await using popup = await addPlugins({
    page: await popupPromise,
    testInfo,
    plugins: [popupVideo],
  });

  await popup.getByRole("button", { name: "Approve" }).click();
  await page.getByText("Signed in as mmkal").waitFor();

  // The popup's click went through the popup's own video-mode middleware...
  await expect(popupVideo.metadata()).resolves.toMatchObject({
    highlights: [{ method: "click" }],
  });
  // ...and the main page's timeline has only the main page's actions.
  await expect(video.metadata()).resolves.toMatchObject({
    highlights: [{ method: "click" }, { method: "waitFor" }],
  });
});

test("each videoMode instance still owns its artifacts after the test", async ({
  page: basePage,
  context,
}, testInfo) => {
  await routeAuthDemoApp(context);
  const video = videoMode({ finalHold: 0, highlight: { mode: "outline", duration: 300 }, trimStart: "never" });
  let popupVideo!: ReturnType<typeof videoMode>;
  {
    await using page = await addPlugins({ page: basePage, testInfo, plugins: [video] });
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

  // Both pages have finalized. Each instance must write its own artifacts and
  // read back its own timeline — not whichever page finalized last.
  expect(popupVideo.outputPaths().metadata).not.toBe(video.outputPaths().metadata);
  await expect(video.metadata()).resolves.toMatchObject({
    highlights: [{ method: "click" }, { method: "waitFor" }],
  });
  await expect(popupVideo.metadata()).resolves.toMatchObject({
    highlights: [{ method: "click" }],
  });
});

test("reusing one videoMode instance on a popup fails with a clear error", async ({
  page: basePage,
  context,
}, testInfo) => {
  await routeAuthDemoApp(context);
  const video = videoMode({ finalHold: 0, highlight: { mode: "outline", duration: 300 }, trimStart: "never" });
  await using page = await addPlugins({ page: basePage, testInfo, plugins: [video] });
  await page.goto("https://app.middlewright.test/");

  const popupPromise = basePage.waitForEvent("popup");
  await page.getByRole("button", { name: "Sign in" }).click();

  // Wiring the same instance to a second page would wipe the main page's
  // timeline, so it must fail loudly instead.
  await expect(
    addPlugins({ page: await popupPromise, testInfo, plugins: [video] }),
  ).rejects.toThrow("create a fresh videoMode() instance for each page");
});
