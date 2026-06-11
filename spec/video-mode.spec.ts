import { test, expect } from "@playwright/test";
import { addPlugins, videoMode } from "../src/index.ts";

test("highlights the element while the action runs, then cleans up", async ({
  page,
}, testInfo) => {
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [videoMode({ pauseBefore: 300, pauseAfterTest: 50 })],
  });
  await plugged.setContent(`
    <button id="btn">press</button>
    <div id="result"></div>
    <script>
      document.getElementById('btn').addEventListener('click', function () {
        // Capture our own inline style at click time, so the test can see
        // what the element looked like while the action ran.
        document.getElementById('result').textContent = this.getAttribute('style') || '(no style)';
      });
    </script>
  `);

  await plugged.locator("#btn").click();

  await expect(plugged.locator("#result")).toContainText("outline: 3px solid gold");
  // Cleanup is fire-and-forget, so poll until the highlight is gone
  await expect
    .poll(() => plugged.locator("#btn").getAttribute("style"))
    .not.toContain("gold");
});

test("skipped methods are not highlighted or slowed down", async ({ page }, testInfo) => {
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [videoMode({ pauseBefore: 5000, pauseAfterTest: 50, skipMethods: ["click"] })],
  });
  await plugged.setContent(`<button id="btn" onclick="this.textContent = 'clicked'">press</button>`);

  const start = Date.now();
  await plugged.locator("#btn").click();
  // A 5s pauseBefore would blow way past this if click weren't skipped
  expect(Date.now() - start).toBeLessThan(2000);
});
