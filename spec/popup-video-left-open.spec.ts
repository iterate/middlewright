import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { test, expect, type BrowserContext } from "@playwright/test";
import { addPlugins, videoMode } from "../src/index.ts";

// 1280x900 doesn't scale evenly into Playwright's 800x562 video, so the
// recorder pads the screencast with a gray strip down the right edge — the
// shape of recording that used to defeat videoMode's timeline calibration.
test.use({ video: "on", viewport: { width: 1280, height: 900 } });

// Seen in the wild on a sign-in flow: the popup hands over a code and stays
// open, and the test carries on in the page that opened it. The render showed
// the popup over the opener's FINAL (signed-in) state, then the popup turning
// solid black, then a black last frame.
test("a popup left open while the test carries on in its opener", async ({
  page: basePage,
  context,
}, testInfo) => {
  await routeCodeSignInApp(context);
  const video = videoMode({ addressBar: false, highlight: { mode: "outline", duration: 400 } });
  {
    await using page = await addPlugins({ page: basePage, testInfo, plugins: [video] });
    await page.goto("https://app.middlewright.test/");

    const popupPromise = basePage.waitForEvent("popup");
    await page.getByRole("button", { name: "Sign in" }).click();
    const popup = await popupPromise;
    await popup.getByRole("button", { name: "Authorize" }).click();
    await popup.getByText("Your code is 1234").waitFor();

    // The popup never closes: the test just goes back to its opener.
    await page.getByLabel("Code").fill("1234");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByText("Signed in as mmkal").waitFor();
  }

  expect(await videoScenes(video.outputPaths().rendered)).toEqual([
    "signed-out app",
    "popup over signed-out app",
    "signed-out app",
    "signed-in app",
  ]);
});

// The popup's recorder is settled and closed during teardown, after the test
// body: none of that — least of all its near-black calibration cover — belongs
// in the video.
test("a popup still open when the test ends", async ({ page: basePage, context }, testInfo) => {
  await routeCodeSignInApp(context);
  const video = videoMode({
    addressBar: false,
    finalHold: 0,
    highlight: { mode: "outline", duration: 400 },
  });
  {
    await using page = await addPlugins({ page: basePage, testInfo, plugins: [video] });
    await page.goto("https://app.middlewright.test/");

    const popupPromise = basePage.waitForEvent("popup");
    await page.getByRole("button", { name: "Sign in" }).click();
    const popup = await popupPromise;
    await popup.getByRole("button", { name: "Authorize" }).click();
    await popup.getByText("Your code is 1234").waitFor();
  }

  expect(await videoScenes(video.outputPaths().rendered)).toEqual([
    "signed-out app",
    "popup over signed-out app",
  ]);
  // Closing it was teardown's doing, so the popup is recorded as never closed.
  const [child] = (await video.metadata()).children;
  expect(child).not.toHaveProperty("closedAt");
});

/**
 * app.middlewright.test opens an auth popup that hands over a code and stays
 * open; typing the code back into the app signs in. Each state fills the
 * viewport with its own flat color, and all content sits in the top-left
 * corner, so a video frame's state is readable from two background pixels.
 */
const routeCodeSignInApp = async (context: BrowserContext) => {
  const style = `
    <style>
      body { margin: 0; padding: 40px; font: 20px system-ui; color: white; }
      button, input, output { display: block; font: inherit; margin-bottom: 16px; }
    </style>
  `;
  await context.route("https://app.middlewright.test/**", async (route) => {
    await route.fulfill({
      body: `
        ${style}
        <body style="background: rgb(${sceneColors["signed-out app"].lit})">
          <button id="signin">Sign in</button>
          <label>Code <input id="code" /></label>
          <button id="continue">Continue</button>
          <output></output>
          <script>
            document.querySelector("#signin").addEventListener("click", () => {
              window.open("https://auth.middlewright.test/authorize");
            });
            document.querySelector("#continue").addEventListener("click", () => {
              if (document.querySelector("#code").value !== "1234") return;
              document.body.style.background = "rgb(${sceneColors["signed-in app"].lit})";
              document.querySelector("output").textContent = "Signed in as mmkal";
            });
          </script>
        </body>
      `,
      contentType: "text/html",
    });
  });
  await context.route("https://auth.middlewright.test/**", async (route) => {
    await route.fulfill({
      body: `
        ${style}
        <body style="background: rgb(${sceneColors.popup.lit})">
          <button id="authorize">Authorize</button>
          <output></output>
          <script>
            document.querySelector("#authorize").addEventListener("click", () => {
              document.querySelector("output").textContent = "Your code is 1234";
            });
          </script>
        </body>
      `,
      contentType: "text/html",
    });
  });
};

// `dimmed` is how the color reads under a popup's backdrop, which darkens and
// desaturates the page beneath it.
const sceneColors = {
  "signed-out app": { dimmed: [47, 68, 63], lit: [13, 148, 136] },
  "signed-in app": { dimmed: [89, 83, 66], lit: [202, 138, 4] },
  popup: { dimmed: [49, 46, 129], lit: [49, 46, 129] },
  black: { dimmed: [0, 0, 0], lit: [0, 0, 0] },
};

const execFile = promisify(execFileCallback);

/**
 * The video as a storyboard: each frame named by what it shows, consecutive
 * repeats collapsed. A frame's edge pixel is always the page (the popup
 * overlay is inset); its center pixel is the popup whenever one is up.
 */
const videoScenes = async (path: string) => {
  const size = { height: 70, width: 100 };
  const { stdout } = await execFile(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      path,
      "-vf",
      `fps=25,scale=${size.width}:${size.height}:flags=neighbor`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ],
    { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
  );
  const frameSize = size.width * size.height * 3;
  const scenes: string[] = [];

  for (let offset = 0; offset + frameSize <= stdout.length; offset += frameSize) {
    const sceneAt = (x: number, y: number) => {
      const pixel = stdout.subarray(offset + (y * size.width + x) * 3);
      const distances = Object.entries(sceneColors).map(([scene, { dimmed, lit }]) => ({
        distance: Math.min(
          Math.hypot(...lit.map((channel, index) => channel - pixel[index])),
          Math.hypot(...dimmed.map((channel, index) => channel - pixel[index])),
        ),
        scene,
      }));
      return distances.sort((left, right) => left.distance - right.distance)[0].scene;
    };
    const edge = sceneAt(1, size.height / 2);
    const center = sceneAt(size.width / 2, size.height / 2);
    const scene = center === "popup" ? `popup over ${edge}` : center;
    if (scenes.at(-1) !== scene) scenes.push(scene);
  }

  return scenes;
};
