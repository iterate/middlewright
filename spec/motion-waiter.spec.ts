import { test as base, expect } from "@playwright/test";
import { addPlugins, motionWaiter } from "../src/index.ts";

const test = base.extend({
  page: async ({ page: basePage }, use, testInfo) => {
    await using page = await addPlugins({
      page: basePage,
      testInfo,
      plugins: [motionWaiter()],
    });
    await page.setContent(getMovingButtonHtml());
    await use(page);
  },
});

test("a static element clicks after a short stillness check", async ({ page }) => {
  const start = Date.now();
  await page.getByRole("button", { name: "static" }).click();
  expect(Date.now() - start).toBeLessThan(700);
  await page.getByText("clicked static at x=0").waitFor();
});

test("a timer-stepped slide is waited out; the click lands at rest", async ({ page }) => {
  // 800ms slide, stepped every 48ms — identical consecutive display frames
  // mid-slide, so vanilla Playwright would click while it moves.
  await page.evaluate(() => (window as any).startSlide(200, 800));
  await page.getByRole("button", { name: "sliding" }).click();
  await page.getByText("clicked sliding at x=200").waitFor();
});

test("without the plugin the same click lands mid-slide (the gap this plugin closes)", async ({
  page,
}) => {
  motionWaiter.settings.enterWith({ disabled: true });
  await page.evaluate(() => (window as any).startSlide(200, 800));
  await page.getByRole("button", { name: "sliding" }).click();
  const clickedAt = await page.evaluate(() => (window as any).__clickedAtX);
  expect(clickedAt).toBeGreaterThanOrEqual(0);
  expect(clickedAt).toBeLessThan(200);
});

test("perpetual motion proceeds once the settle budget runs out", async ({ page }) => {
  await page.evaluate(() => (window as any).startMarquee());
  const start = Date.now();
  await page.getByRole("button", { name: "sliding" }).click();
  const elapsed = Date.now() - start;
  expect(elapsed).toBeGreaterThanOrEqual(motionWaiter.defaults.settleTimeout);
  await page.getByText(/clicked sliding at x=\d/).waitFor();
});

test("an explicit timeout passes straight through, like spinner-waiter's escape hatch", async ({
  page,
}) => {
  await page.evaluate(() => (window as any).startSlide(200, 800));
  // timeout: the explicit-timeout escape hatch IS the subject under test — motion-waiter passes through, like spinner-waiter does
  await page.getByRole("button", { name: "sliding" }).click({ timeout: 5_000 });
  const clickedAt = await page.evaluate(() => (window as any).__clickedAtX);
  expect(clickedAt).toBeLessThan(200);
});

function getMovingButtonHtml() {
  return `
    <body>
      <button id="static-button" style="position: fixed; top: 200px; left: 0">static</button>
      <button id="sliding-button" style="position: fixed; top: 100px; left: 0">sliding</button>
      <div id="result"></div>
      <script>
        const sliding = document.getElementById("sliding-button");
        for (const button of document.querySelectorAll("button")) {
          button.addEventListener("click", () => {
            window.__clickedAtX = Math.round(button.getBoundingClientRect().x);
            document.getElementById("result").textContent =
              "clicked " + button.textContent + " at x=" + window.__clickedAtX;
          });
        }
        // A JS-timer slide from x=0 to x=toX — steps coarser than the display
        // refresh, the cadence Playwright's two-frame stability check misses.
        window.startSlide = (toX, durationMs) => {
          const startedAt = Date.now();
          const timer = setInterval(() => {
            const progress = Math.min((Date.now() - startedAt) / durationMs, 1);
            sliding.style.left = toX * progress + "px";
            if (progress >= 1) clearInterval(timer);
          }, 48);
        };
        window.startMarquee = () => {
          let x = 0;
          setInterval(() => {
            x = (x + 8) % 200;
            sliding.style.left = x + "px";
          }, 40);
        };
      </script>
    </body>
  `;
}
