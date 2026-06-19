import { execFile as execFileCallback } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { test, expect } from "@playwright/test";
import { addPlugins, spinnerWaiter, videoMode } from "../src/index.ts";

const execFile = promisify(execFileCallback);

test.use({ video: "on" });

test("writes a video with dead air removed", async ({ page }, testInfo) => {
  const video = videoMode({ pauseBefore: 1000, pauseAfterTest: 700 });
  {
    await using plugged = await addPlugins({
      page,
      testInfo,
      plugins: [
        spinnerWaiter({
          log: (message) => console.log(`[spinnerWaiter] ${message}`),
          spinnerTimeout: 12_000,
        }),
        video,
      ],
    });
    await plugged.setViewportSize({ width: 800, height: 600 });
    await plugged.setContent(`
      <main style="display: grid; gap: 16px; min-height: 100vh; place-items: center; font: 24px sans-serif;">
        <h1>Dead air workflow</h1>
        <p id="status">Ready</p>
        <button id="start">Start import</button>
      </main>
      <script>
        const main = document.querySelector('main');
        const status = document.getElementById('status');
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

        function showSpinner(text) {
          document.getElementById('spinner')?.remove();
          main.insertAdjacentHTML('beforeend', '<div id="spinner" aria-label="Loading">' + text + '...</div>');
        }

        function hideSpinner() {
          document.getElementById('spinner')?.remove();
        }

        document.getElementById('start').addEventListener('click', async () => {
          status.textContent = 'Import requested';
          document.getElementById('start').remove();
          showSpinner('Loading records');
          await sleep(2200);
          hideSpinner();
          main.insertAdjacentHTML('beforeend', '<button id="review">Review records</button>');

          document.getElementById('review').addEventListener('click', async () => {
            status.textContent = 'Records reviewed';
            document.getElementById('review').remove();
            showSpinner('Processing approval');
            await sleep(2600);
            hideSpinner();
            main.insertAdjacentHTML('beforeend', '<button id="approve">Approve import</button>');

            document.getElementById('approve').addEventListener('click', async () => {
              status.textContent = 'Approved';
              document.getElementById('approve').remove();
              await sleep(1600);
              main.insertAdjacentHTML('beforeend', '<button id="receipt">Download receipt</button>');

              document.getElementById('receipt').addEventListener('click', async () => {
                status.textContent = 'Receipt requested';
                document.getElementById('receipt').remove();
                showSpinner('Finalizing receipt');
                await sleep(1800);
                hideSpinner();
                main.insertAdjacentHTML('beforeend', '<div id="done">Receipt ready</div>');
              });
            });
          });
        });
      </script>
    `);

    await plugged.locator("#start").click();
    await plugged.locator("#review").click();
    await plugged.locator("#approve").click();
    await video.deadAir(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1700));
    });
    await plugged.locator("#receipt").click();

    await plugged.locator("#done").waitFor();
    await expect(plugged.locator("#done")).toContainText("Receipt ready");
  }

  const metadata = JSON.parse(
    await readFile(join(testInfo.outputDir, "video-mode.json"), "utf8"),
  );
  expect(metadata).toMatchObject({
    outputs: {
      deadAirRemoved: "video-tight.webm",
      raw: "video-raw.webm",
    },
  });
  expect(
    metadata.deadAir.filter((span: { end: number; start: number }) => span.end - span.start >= 1500)
      .length,
  ).toBeGreaterThanOrEqual(4);

  const rawPath = join(testInfo.outputDir, metadata.outputs.raw);
  const tightPath = join(testInfo.outputDir, metadata.outputs.deadAirRemoved);
  const rawStats = await stat(rawPath);
  const tightStats = await stat(tightPath);
  console.log(`raw video written to ${rawPath}`);
  console.log(`tight video written to ${tightPath}`);

  expect(rawStats.size).toBeGreaterThan(0);
  expect(tightStats.size).toBeGreaterThan(0);

  const rawDuration = await videoDurationMs(rawPath);
  const tightDuration = await videoDurationMs(tightPath);
  expect(tightDuration).toBeLessThan(rawDuration);
});

const videoDurationMs = async (path: string) => {
  const { stdout } = await execFile(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nokey=1:noprint_wrappers=1", path],
    { maxBuffer: 1024 * 1024 },
  );

  return Math.round(Number(stdout.trim()) * 1000);
};
