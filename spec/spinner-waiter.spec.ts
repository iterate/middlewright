import { test as base, expect } from "@playwright/test";
import { addPlugins, spinnerWaiter } from "../src/index.ts";

const test = base.extend<{ slowMutationTimeout: number }>({
  slowMutationTimeout: 2000,
  page: async ({ page, slowMutationTimeout }, use, testInfo) => {
    await using _page = await addPlugins({
      page,
      testInfo,
      plugins: [spinnerWaiter()],
    });
    await _page.setContent(getTestPageHtml(slowMutationTimeout));
    await use(_page);
  },
});

test("slow button succeeds when there's a spinner", async ({ page }) => {
  await run(page);
});

test("slow button fails without spinner waiter", async ({ page }) => {
  spinnerWaiter.settings.enterWith({ disabled: true });
  const error = await run(page).catch((e) => e);
  expect(error.message).toMatch(/Timeout .* exceeded/);
});

// The plugin's 1s pre-action visibility check delays the final action, so a
// 2s mutation could accidentally beat the action timeout - use a slower one.
const testSlower = test.extend({ slowMutationTimeout: 6000 });

testSlower("slow button fails when spinner doesn't match selector", async ({ page }) => {
  spinnerWaiter.settings.enterWith({
    spinnerSelectors: [".myCustomSpinnerClass"],
  });
  const error = await run(page).catch((e) => e);
  expect(error.message).toMatch(/Timeout .* exceeded/);
  expect(error.message).toMatch(/If this is a slow operation.../);
});
testSlower("slow button fails when spinner times out", async ({ page }) => {
  spinnerWaiter.settings.enterWith({ spinnerTimeout: 3001 });
  const error = await run(page).catch((e) => e);
  expect(error.message).toMatch(/Timeout .* exceeded/);
  expect(error.message).toMatch(/spinner was still visible after .*/i);
});

test("settings.run scopes an override to a single call", async ({ page }) => {
  await page.locator("button", { hasText: "slow button" }).click();

  // Disabled just for this call — fails fast instead of waiting out the spinner
  const error = await spinnerWaiter.settings
    .run({ disabled: true }, () =>
      page.locator("button", { hasText: "i have been clicked" }).waitFor(),
    )
    .catch((e: Error) => e);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toMatch(/Timeout .* exceeded/);

  // Outside the run() scope the spinner waiter is back, so this succeeds
  await page.locator("button", { hasText: "i have been clicked" }).waitFor();
});

test("bails early when spinner disappears without expected element", async ({ page }) => {
  // Override page content for this test: spinner shows for 2s then disappears with wrong result
  await page.setContent(`
    <button id="start" onclick="
      document.querySelector('#result').textContent = 'processing...';
      setTimeout(() => document.querySelector('#result').textContent = 'Failed: something went wrong', 2000);
      setTimeout(() => document.querySelector('#result').textContent = 'success', 10_000); // should be too little, too late
    ">start operation</button>
    <div id="result"></div>
  `);

  spinnerWaiter.settings.enterWith({ spinnerTimeout: 30_000 });
  await page.locator("#start").click();

  const start = Date.now();
  const error = await page
    .locator("#result", { hasText: "success" })
    .waitFor()
    .catch((e: Error) => e);
  const elapsed = Date.now() - start;

  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toMatch(/Loading finished.*spinner disappeared/i);
  // Should bail within ~10s (2s spinner + 3s grace + buffer), not wait full 30s
  expect(elapsed).toBeLessThan(15_000);
});

function run(page: import("@playwright/test").Page) {
  return page
    .locator("button", { hasText: "slow button" })
    .click()
    .then(() => page.locator("button", { hasText: "i have been clicked" }).waitFor());
}

function getTestPageHtml(slowMutationTimeout: number) {
  return `
    <head><title>Spinner Waiter Test</title></head>
    <body>
      <button id="slow-button" onclick="handleClick()">slow button</button>
      <script>
        async function handleClick() {
          const btn = document.querySelector('#slow-button');
          btn.textContent = 'loading...';
          setTimeout(() => btn.textContent = 'i have been clicked', ${slowMutationTimeout});
        }
      </script>
    </body>
  `;
}
