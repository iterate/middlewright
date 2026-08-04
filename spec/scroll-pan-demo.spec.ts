import { test, expect } from "@playwright/test";
import { addPlugins, videoMode } from "../src/index.ts";

test.use({
  video: "on",
  viewport: { height: 720, width: 480 },
});

// A watchable demo of offscreen pans and the pull-request media fixture: a
// deploy-log page with targets above and below the fold. Queries (waitFor)
// never scroll the live page, so their pans return; interactions (click)
// really scroll via Playwright actionability, so their pans stay. test.step
// titles render as captions in the video. AGENTS.md asks for this render in
// pull requests that change pan behavior, alongside the todo-app baseline.
test("deploy log demo: pans both directions while only clicks really scroll", async ({
  page,
}, testInfo) => {
  const video = videoMode();
  {
    await using plugged = await addPlugins({ page, testInfo, plugins: [video] });
    await plugged.setContent(getDemoHtml());

    await test.step("waitFor below the fold: no real scroll, the video pans down and back", async () => {
      await plugged.getByText("Deploy succeeded").waitFor();
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    });

    await test.step("click below the fold: Playwright really scrolls down, the video pans and stays", async () => {
      await plugged.getByRole("button", { name: "View summary" }).click();
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      await plugged.getByText("All 34 checks passed").waitFor();
    });

    await test.step("waitFor above the fold: no real scroll, the video pans up and back", async () => {
      await plugged.getByText("Deploy is live").waitFor();
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    });

    await test.step("click above the fold: Playwright really scrolls up, the video pans and stays", async () => {
      await plugged.getByRole("button", { name: "Copy status link" }).click();
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      await plugged.getByText("Link copied").waitFor();
    });

    await page.waitForTimeout(300);
  }

  const metadata = await video.metadata();
  expect(
    metadata.highlights.map((highlight) => ({
      method: highlight.method,
      pan: highlight.pan && { back: highlight.pan.back },
    })),
  ).toEqual([
    { method: "waitFor", pan: { back: true } },
    { method: "click", pan: { back: false } },
    { method: "waitFor", pan: undefined },
    { method: "waitFor", pan: { back: true } },
    { method: "click", pan: { back: false } },
    { method: "waitFor", pan: undefined },
  ]);
});

const getDemoHtml = () => `
  <style>
    body { margin: 0; font-family: -apple-system, system-ui, sans-serif; color: #1a2233; background: #fff; }
    header { background: #1d2d50; color: white; padding: 16px 32px; font-size: 19px; font-weight: 600; display: flex; align-items: center; gap: 14px; }
    #badge { display: none; font-size: 13px; font-weight: 600; background: #1c7c3c; border-radius: 999px; padding: 4px 12px; }
    #copy { display: none; margin-left: auto; background: #3d548f; color: white; border: 0; border-radius: 7px; padding: 8px 14px; font-size: 13px; cursor: pointer; }
    #copied { display: none; margin-left: 10px; font-size: 13px; color: #9fd7ae; }
    main { padding: 24px 32px 48px; }
    .row { padding: 9px 14px; border-bottom: 1px solid #e3e8f0; font: 13px/1.4 ui-monospace, monospace; color: #445; }
    .row .t { color: #98a2b8; margin-right: 12px; }
    #status { display: none; margin: 28px 0 0; padding: 20px 24px; border: 1px solid #b7e3c0; background: #eefaf1; border-radius: 10px; }
    #status h2 { margin: 0 0 6px; font-size: 17px; color: #1c7c3c; }
    #status p { margin: 0 0 14px; font-size: 14px; }
    #status button { background: #1c7c3c; color: white; border: 0; border-radius: 7px; padding: 10px 16px; font-size: 14px; cursor: pointer; }
    #summary { display: none; margin-top: 12px; font-size: 14px; color: #1c7c3c; font-weight: 600; }
  </style>
  <header>
    <span>acme-app &middot; deploy #4128</span>
    <span id="badge">&#10003; Deploy is live</span>
    <button id="copy" onclick="document.querySelector('#copied').style.display='inline'">Copy status link</button>
    <span id="copied">Link copied</span>
  </header>
  <main>
    <div id="rows"></div>
    <section id="status">
      <h2>&#10003; Deploy succeeded</h2>
      <p>Build 4128 is live in production.</p>
      <button onclick="reportLive()">View summary</button>
      <div id="summary">All 34 checks passed &middot; 0 regressions</div>
    </section>
  </main>
  <script>
    const steps = ['resolving dependencies', 'compiling modules', 'bundling client assets', 'optimizing images', 'running unit tests', 'running integration tests', 'building container image', 'pushing image to registry', 'rolling out to canary', 'promoting to production'];
    const rows = document.querySelector('#rows');
    for (let i = 0; i < 34; i++) {
      const div = document.createElement('div');
      div.className = 'row';
      const seconds = (i * 3.7 + 2.1).toFixed(1);
      div.innerHTML = '<span class="t">' + seconds + 's</span> ' + steps[i % steps.length] + ' &mdash; ok';
      rows.appendChild(div);
    }
    setTimeout(() => {
      document.querySelector('#status').style.display = 'block';
    }, 700);
    function reportLive() {
      document.querySelector('#summary').style.display = 'block';
      setTimeout(() => {
        document.querySelector('#badge').style.display = 'inline';
        document.querySelector('#copy').style.display = 'inline';
      }, 500);
    }
  </script>
`;
