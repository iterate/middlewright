import { test, expect } from "@playwright/test";
import { addPlugins, videoMode } from "../src/index.ts";

test.use({ video: "on" });

test("default starts at the first locator invocation", async ({ page }, testInfo) => {
  const video = videoMode({ finalHold: 700, highlight: false });

  const metadata = await recordStartTimeline({
    manualStartAtMs: false,
    page,
    testInfo,
    video,
  });

  expect(metadata.sourceRange.start).toBeGreaterThan(1600);
  expect(metadata.sourceRange.start).toBeLessThan(2200);
});

test("manual start time overrides the default", async ({ page }, testInfo) => {
  const video = videoMode({ finalHold: 700, highlight: false });

  const metadata = await recordStartTimeline({
    manualStartAtMs: 1400,
    page,
    testInfo,
    video,
  });

  expect(metadata.sourceRange.start).toBeGreaterThan(1100);
  expect(metadata.sourceRange.start).toBeLessThan(1700);
});

test("selector start begins when its marker becomes visible", async ({ page }, testInfo) => {
  const video = videoMode({
    finalHold: 700,
    highlight: false,
    trimStart: ["selector", "[data-video-start]"],
  });

  const metadata = await recordStartTimeline({
    manualStartAtMs: false,
    page,
    testInfo,
    video,
  });

  expect(metadata.sourceRange.start).toBeGreaterThan(1300);
  expect(metadata.sourceRange.start).toBeLessThan(1900);
});

test("blank detection begins when the loading shell paints", async ({ page }, testInfo) => {
  const video = videoMode({ finalHold: 700, highlight: false, trimStart: "detect-blank" });

  const metadata = await recordStartTimeline({
    manualStartAtMs: false,
    page,
    testInfo,
    video,
  });

  expect(metadata.sourceRange.start).toBeGreaterThan(800);
  expect(metadata.sourceRange.start).toBeLessThan(1800);
});

test('trimStart: "never" keeps the whole recording', async ({ page }, testInfo) => {
  const video = videoMode({ finalHold: 700, highlight: false, trimStart: "never" });

  const metadata = await recordStartTimeline({
    manualStartAtMs: false,
    page,
    testInfo,
    video,
  });

  expect(metadata.sourceRange.start).toBeUndefined();
});

const recordStartTimeline = async (options: {
  manualStartAtMs: false | number;
  page: any;
  testInfo: any;
  video: ReturnType<typeof videoMode>;
}) => {
  {
    await using page = await addPlugins({
      page: options.page,
      testInfo: options.testInfo,
      plugins: [options.video],
    });
    await page.setViewportSize({ width: 800, height: 450 });
    await page.setContent(startTimelinePage);

    if (options.manualStartAtMs !== false) {
      await page.waitForTimeout(options.manualStartAtMs);
      page.videoMode.setStartTime();
      await page.waitForTimeout(FIRST_LOCATOR_AT_MS - options.manualStartAtMs);
    } else {
      await page.waitForTimeout(FIRST_LOCATOR_AT_MS);
    }

    await page.locator("#ready").waitFor();
    await page.waitForTimeout(400);
  }

  return await options.video.metadata();
};

const FIRST_LOCATOR_AT_MS = 1900;

const startTimelinePage = `
  <style>
    @keyframes recorder-heartbeat {
      from { transform: translateX(0); }
      to { transform: translateX(790px); }
    }
    * { box-sizing: border-box; }
    body { margin: 0; font: 22px system-ui; }
    [hidden] { display: none !important; }
    #recorder-heartbeat {
      animation: recorder-heartbeat 100ms linear infinite alternate;
      background: rgb(254, 254, 254);
      height: 2px;
      position: fixed;
      width: 2px;
    }
    main { align-content: center; display: grid; height: 100vh; padding: 72px; }
    #shell { background: #172554; color: white; }
    #app { background: #dcfce7; color: #14532d; }
    .milestone { background: #dbeafe; color: #1e3a8a; padding: 8px 12px; width: max-content; }
  </style>
  <div id="recorder-heartbeat"></div>
  <main id="shell" hidden>
    <h1>Loading workspace…</h1>
    <p id="selector" class="milestone" data-video-start hidden>Ready selector visible</p>
    <p id="locator" class="milestone" hidden>First locator invoked</p>
  </main>
  <main id="app" hidden>
    <h1>Workspace ready</h1>
    <button id="ready">Continue</button>
  </main>
  <script>
    setTimeout(() => { document.querySelector('#shell').hidden = false; }, 1200);
    setTimeout(() => { document.querySelector('#selector').hidden = false; }, 1600);
    setTimeout(() => { document.querySelector('#locator').hidden = false; }, 1850);
    setTimeout(() => {
      document.querySelector('#shell').hidden = true;
      document.querySelector('#app').hidden = false;
    }, 2400);
  </script>
`;
