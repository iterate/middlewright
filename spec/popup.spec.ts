import { test, expect } from "@playwright/test";
import type { BrowserContext } from "@playwright/test";
import { addPlugins, videoMode } from "../src/index.ts";

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

/**
 * app.middlewright.test shows a Sign in button that opens an auth popup on
 * auth.middlewright.test; approving there posts a message back to the opener,
 * which then shows who signed in. Routed on the context so the popup page is
 * covered too.
 */
const routeAuthDemoApp = async (context: BrowserContext) => {
  await context.route("https://app.middlewright.test/**", async (route) => {
    await route.fulfill({
      body: `
        <main>
          <button id="signin">Sign in</button>
          <output></output>
          <script>
            document.querySelector("#signin").addEventListener("click", () => {
              window.open("https://auth.middlewright.test/authorize");
            });
            window.addEventListener("message", (event) => {
              if (event.data === "approved") {
                document.querySelector("output").textContent = "Signed in as mmkal";
              }
            });
          </script>
        </main>
      `,
      contentType: "text/html",
    });
  });
  await context.route("https://auth.middlewright.test/**", async (route) => {
    await route.fulfill({
      body: `
        <main>
          <h1>Authorize middlewright?</h1>
          <button id="approve">Approve</button>
          <script>
            document.querySelector("#approve").addEventListener("click", () => {
              window.opener.postMessage("approved", "*");
            });
          </script>
        </main>
      `,
      contentType: "text/html",
    });
  });
};
