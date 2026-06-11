import { test, expect } from "@playwright/test";
import { addPlugins, hydrationWaiter } from "../src/index.ts";

test("waits for hydration before clicking", async ({ page }, testInfo) => {
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [hydrationWaiter()],
  });
  await plugged.setContent(getTestPageHtml(1500));

  // The click handler only exists after "hydration" (1.5s in). Without the
  // plugin, this click would land on a dead button.
  await plugged.locator("#cta").click();
  await plugged.locator("#result", { hasText: "done" }).waitFor();
});

test("without the plugin, clicking a dead button does nothing", async ({ page }, testInfo) => {
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [hydrationWaiter({ disabled: true })],
  });
  await plugged.setContent(getTestPageHtml(1500));

  await plugged.locator("#cta").click();
  const error = await plugged
    .locator("#result", { hasText: "done" })
    .waitFor()
    .catch((e: Error) => e);

  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toMatch(/Timeout .* exceeded/);
});

test("custom selector", async ({ page }, testInfo) => {
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [hydrationWaiter({ selector: ".app-loading" })],
  });
  await plugged.setContent(getTestPageHtml(1500, "app-loading"));

  await plugged.locator("#cta").click();
  await plugged.locator("#result", { hasText: "done" }).waitFor();
});

function getTestPageHtml(hydrationDelayMs: number, markerClass?: string) {
  const marker = markerClass
    ? `<div class="${markerClass}">hydrating…</div>`
    : `<div data-hydrated="false">hydrating…</div>`;
  return `
    <body>
      ${marker}
      <button id="cta">do the thing</button>
      <div id="result"></div>
      <script>
        // Simulate framework hydration: the click handler only attaches after a delay
        setTimeout(() => {
          document.body.firstElementChild.style.display = 'none';
          document.getElementById('cta').addEventListener('click', () => {
            document.getElementById('result').textContent = 'done';
          });
        }, ${hydrationDelayMs});
      </script>
    </body>
  `;
}
