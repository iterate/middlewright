import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { test, expect } from "@playwright/test";
import { addPlugins, videoMode } from "../src/index.ts";

const execFile = promisify(execFileCallback);

test.use({ video: "on" });

// Regression guard: rendered videos used to flash black near the end. The raw
// recording's tail is videoMode's own near-black rgb(1,2,3) calibration cover
// (settleVideoRecorder), extended by Playwright's >=1s final-frame padding —
// and the wall→raw calibration derived from the recorder's ENDPOINT assumed
// that padding stops at the close instant. It doesn't (it lands ~1s past it),
// so every translated coordinate sat ~1s too deep in the raw and the cover
// leaked into the render right before the finalHold: a black FLASH. Seen in
// the wild on iterate/iterate#2523's demo video (0.32s). The fix calibrates
// from the cover itself — its paint time is stamped and its first raw frame
// is detected by color — and caps the derived source range before it.
test("the rendered video never flashes black", async ({ page: basePage }, testInfo) => {
  const video = videoMode({ finalHold: 700, highlight: { mode: "pointer", duration: 500 } });
  {
    await using page = await addPlugins({ page: basePage, testInfo, plugins: [video] });
    await page.setViewportSize({ width: 800, height: 450 });
    await page.setContent(receiptPage);
    await page.getByRole("textbox", { name: "Report title" }).fill("Q3 revenue");
    await page.locator("#send").click();
    await page.locator("#receipt").waitFor();
    await page.waitForTimeout(400);
  }

  const frames = await renderedFrames(video.outputPaths().rendered);
  const blackFrameCount = frames.filter(isNearBlack).length;
  expect(blackFrameCount).toBe(0);
});

// A light-background page with a heartbeat animation (continuous screencast
// frames) and one action, so the timeline has content but no trailing
// highlight hold — the shape of any short demo. Nothing here is ever black.
const receiptPage = `
  <style>
    @keyframes heartbeat {
      from { transform: translateX(0); }
      to { transform: translateX(790px); }
    }
    body { margin: 0; font: 22px system-ui; background: #f8fafc; color: #0f172a; }
    #heartbeat {
      animation: heartbeat 100ms linear infinite alternate;
      background: rgb(254, 254, 254);
      height: 2px;
      position: fixed;
      width: 2px;
    }
    main { display: grid; gap: 16px; padding: 72px; }
    #receipt { background: #dcfce7; color: #14532d; padding: 8px 12px; width: max-content; }
  </style>
  <div id="heartbeat"></div>
  <main>
    <h1>Send the report</h1>
    <label>Report title <input type="text" /></label>
    <button id="send">Send</button>
    <p id="receipt" hidden>Report sent</p>
  </main>
  <script>
    document.querySelector('#send').addEventListener('click', () => {
      setTimeout(() => { document.querySelector('#receipt').hidden = false; }, 150);
    });
  </script>
`;

type VideoFrame = { data: Buffer; height: number; width: number };

// 25fps rawvideo extraction, same mechanics as video-mode-ffmpeg.spec.ts.
const renderedFrames = async (path: string): Promise<VideoFrame[]> => {
  const { stdout: probe } = await execFile("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=p=0",
    path,
  ]);
  const [width, height] = probe.trim().split(",").map(Number);
  const { stdout } = await execFile(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-i", path, "-vf", "fps=25", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
    { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 },
  );
  const frameSize = width * height * 3;
  const frames: VideoFrame[] = [];
  for (let offset = 0; offset + frameSize <= stdout.length; offset += frameSize) {
    frames.push({ data: (stdout as Buffer).subarray(offset, offset + frameSize), height, width });
  }
  return frames;
};

// The demo page is light throughout, so "near black" (mean channel < 16/255)
// can only come from footage the page never painted.
const isNearBlack = (frame: VideoFrame) => {
  let total = 0;
  for (let index = 0; index < frame.data.length; index += 1) {
    total += frame.data[index];
  }
  return total / frame.data.length < 16;
};
