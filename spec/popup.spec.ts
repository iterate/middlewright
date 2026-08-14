import { test, expect } from "@playwright/test";
import { addPlugins, videoMode } from "../src/index.ts";
import type { Plugin } from "../src/index.ts";
import { routeAuthDemoApp } from "./auth-demo-app.ts";

test("popups are wrapped automatically", async ({ page: basePage, context }, testInfo) => {
  await routeAuthDemoApp(context);
  const actions: string[] = [];
  // No forPopup hook: the plugin is re-registered as-is on the popup.
  const recorder: Plugin = {
    name: "action-recorder",
    middleware: async (ctx, next) => {
      actions.push(`${ctx.method} on ${new URL(ctx.page.url()).host}`);
      return next();
    },
  };
  await using page = await addPlugins({ page: basePage, testInfo, plugins: [recorder] });
  await page.goto("https://app.middlewright.test/");

  const popupPromise = basePage.waitForEvent("popup");
  await page.getByRole("button", { name: "Sign in" }).click();
  const popup = await popupPromise;

  // No addPlugins call for the popup — it's already wrapped.
  await popup.getByRole("button", { name: "Approve" }).click();
  await page.getByText("Signed in as mmkal").waitFor();

  expect(actions).toEqual([
    "click on app.middlewright.test",
    "click on auth.middlewright.test",
    "waitFor on app.middlewright.test",
  ]);
});

test("forPopup controls what popups get", async ({ page: basePage, context }, testInfo) => {
  await routeAuthDemoApp(context);
  const actions: string[] = [];
  const record = (label: string) => {
    const middleware: Plugin["middleware"] = async (ctx, next) => {
      actions.push(`${label}: ${ctx.method} on ${new URL(ctx.page.url()).host}`);
      return next();
    };
    return middleware;
  };
  const inherited: Plugin = {
    name: "inherited",
    middleware: record("parent"),
    forPopup: () => ({ name: "inherited-child", middleware: record("child") }),
  };
  const skipped: Plugin = {
    name: "skipped-on-popups",
    middleware: record("skipped"),
    forPopup: () => null,
  };
  await using page = await addPlugins({ page: basePage, testInfo, plugins: [inherited, skipped] });
  await page.goto("https://app.middlewright.test/");

  const popupPromise = basePage.waitForEvent("popup");
  await page.getByRole("button", { name: "Sign in" }).click();
  await (await popupPromise).getByRole("button", { name: "Approve" }).click();
  await page.getByText("Signed in as mmkal").waitFor();

  expect(actions).toEqual([
    "parent: click on app.middlewright.test",
    "skipped: click on app.middlewright.test",
    "child: click on auth.middlewright.test",
    "parent: waitFor on app.middlewright.test",
    "skipped: waitFor on app.middlewright.test",
  ]);
});

test("wrapping an already-wrapped page throws", async ({ page: basePage, context }, testInfo) => {
  await routeAuthDemoApp(context);
  await using page = await addPlugins({ page: basePage, testInfo, plugins: [] });

  await expect(addPlugins({ page: basePage, testInfo, plugins: [] })).rejects.toThrow(
    "already has plugins",
  );

  // Popups are auto-wrapped, so wrapping one manually is also a double wrap.
  await page.goto("https://app.middlewright.test/");
  const popupPromise = basePage.waitForEvent("popup");
  await page.getByRole("button", { name: "Sign in" }).click();
  const popup = await popupPromise;
  await expect(addPlugins({ page: popup, testInfo, plugins: [] })).rejects.toThrow(
    "popups: false",
  );
});

test("popups: false leaves popups unwrapped", async ({ page: basePage, context }, testInfo) => {
  await routeAuthDemoApp(context);
  const actions: string[] = [];
  const recorder: Plugin = {
    name: "action-recorder",
    middleware: async (ctx, next) => {
      actions.push(`${ctx.method} on ${new URL(ctx.page.url()).host}`);
      return next();
    },
  };
  await using page = await addPlugins({
    page: basePage,
    testInfo,
    plugins: [recorder],
    popups: false,
  });
  await page.goto("https://app.middlewright.test/");

  const popupPromise = basePage.waitForEvent("popup");
  await page.getByRole("button", { name: "Sign in" }).click();
  await (await popupPromise).getByRole("button", { name: "Approve" }).click();
  await page.getByText("Signed in as mmkal").waitFor();

  expect(actions).toEqual([
    "click on app.middlewright.test",
    "waitFor on app.middlewright.test",
  ]);
});

test("videoMode records popup actions as a child timeline", async ({
  page: basePage,
  context,
}, testInfo) => {
  await routeAuthDemoApp(context);
  const video = videoMode({ finalHold: 0, highlight: { mode: "outline", duration: 300 }, trimStart: "never" });
  await using page = await addPlugins({ page: basePage, testInfo, plugins: [video] });
  await page.goto("https://app.middlewright.test/");

  const popupPromise = basePage.waitForEvent("popup");
  await page.getByRole("button", { name: "Sign in" }).click();
  await (await popupPromise).getByRole("button", { name: "Approve" }).click();
  await page.getByText("Signed in as mmkal").waitFor();

  const metadata = await video.metadata();
  expect(metadata).toMatchObject({
    // The main timeline has only the main page's actions...
    highlights: [{ method: "click" }, { method: "waitFor" }],
    // ...and the popup's actions land on a child timeline of the same clock.
    children: [
      {
        openedAt: expect.any(Number),
        highlights: [{ method: "click" }],
      },
    ],
  });
  const [child] = metadata.children;
  expect(child.openedAt).toBeGreaterThanOrEqual(metadata.highlights[0].start);
  expect(child.openedAt).toBeLessThanOrEqual(child.highlights[0].start);
});

test("a manually wrapped popup runs actions through its own plugins", async ({
  page: basePage,
  context,
}, testInfo) => {
  await routeAuthDemoApp(context);
  const video = videoMode({ finalHold: 0, highlight: { mode: "outline", duration: 300 }, trimStart: "never" });
  await using page = await addPlugins({ page: basePage, testInfo, plugins: [video], popups: false });
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
  await using page = await addPlugins({ page: basePage, testInfo, plugins: [video], popups: false });
  await page.goto("https://app.middlewright.test/");

  const popupPromise = basePage.waitForEvent("popup");
  await page.getByRole("button", { name: "Sign in" }).click();

  // Wiring the same instance to a second page would wipe the main page's
  // timeline, so it must fail loudly instead.
  await expect(
    addPlugins({ page: await popupPromise, testInfo, plugins: [video] }),
  ).rejects.toThrow("create a fresh videoMode() instance for each page");
});
