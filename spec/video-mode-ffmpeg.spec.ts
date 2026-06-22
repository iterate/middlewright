import { execFile as execFileCallback } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { test, expect } from "@playwright/test";
import { addPlugins, spinnerWaiter, videoMode } from "../src/index.ts";

const execFile = promisify(execFileCallback);

test.use({ video: "on" });

test("writes a video with dead air removed", async ({ page }, testInfo) => {
  const deadAirThresholdMs = 300;
  const video = videoMode({
    deadAirThreshold: deadAirThresholdMs,
    pauseBefore: 1000,
    pauseAfterTest: 700,
  });
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
      <main style="display: flex; flex-direction: column; gap: 16px">
        <div data-spinner="true" style="visibility: hidden;">Loading...</div>
        <div class="stages" style="display: flex; gap: 16px;">
          <button data-stage-index="0">Start import</button>
          <button data-stage-index="1">Review records</button>
          <button data-stage-index="2">Approve import</button>
          <button data-stage-index="3">Download receipt</button>
        </div>
        <div id="result"></div>
      </main>
      <script>
        const spinner = document.querySelector('[data-spinner]');
        const buttons = Array.from(document.querySelectorAll('button[data-stage-index]'));
        const result = document.querySelector('#result');
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const stages = [
          { delay: 2200 },
          { delay: 2600 },
          { delay: 1600 },
          { delay: 1800, done: true },
        ];

        function setActiveStage(index) {
          spinner.style.visibility = 'hidden';
          buttons.forEach((button, buttonIndex) => {
            button.disabled = buttonIndex !== index;
          });
        }

        buttons.forEach((button) => {
          button.addEventListener('click', async () => {
            buttons.forEach((button) => {
              button.disabled = true;
            });
            spinner.style.visibility = 'visible';

            const index = Number(button.dataset.stageIndex);
            const stage = stages[index];
            await sleep(stage.delay);

            if (stage.done) {
              spinner.style.visibility = 'hidden';
              result.textContent = 'Receipt ready';
              return;
            }

            setActiveStage(index + 1);
          });
        });

        setActiveStage(0);
      </script>
    `);

    await plugged.getByText("Start import").click();
    await plugged.getByText("Review records").click();
    await plugged.getByText("Approve import").click();
    await video.deadAir(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1700));
    });
    await plugged.getByText("Download receipt").click();

    await plugged.getByText("Receipt ready").waitFor();
    await expect(plugged.getByText("Receipt ready")).toContainText("Receipt ready");
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
  const finalDeadAirSpan = metadata.deadAir[metadata.deadAir.length - 1];
  const previousDeadAirSpan = metadata.deadAir[metadata.deadAir.length - 2];
  expect(finalDeadAirSpan.start - previousDeadAirSpan.end).toBeGreaterThanOrEqual(400);

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
  const expectedTightDuration =
    rawDuration -
    metadata.deadAir.reduce((removedDuration: number, span: { end: number; start: number }) => {
      return removedDuration + Math.max(0, span.end - span.start - deadAirThresholdMs);
    }, 0);

  expect(tightDuration).toBeLessThan(rawDuration);
  expect(Math.abs(tightDuration - expectedTightDuration)).toBeLessThan(1000);
});

const videoDurationMs = async (path: string) => {
  const { stdout } = await execFile(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nokey=1:noprint_wrappers=1", path],
    { maxBuffer: 1024 * 1024 },
  );

  return Math.round(Number(stdout.trim()) * 1000);
};
