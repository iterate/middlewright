import { test as base, expect } from "@playwright/test";
import { addPlugins, spinnerWaiter, type Plugin } from "../src/index.ts";

const test = base.extend<{ slowMutationTimeout: number }>({
  page: async ({ page: basePage }, use, testInfo) => {
    await using page = await addPlugins({
      page: basePage,
      testInfo,
      plugins: [spinnerWaiter()],
    });
    await page.setContent(`
      <head><title>Spinner Waiter Test</title></head>
      <body>
        <button id="slow-button" onclick="handleClick()">start work</button>
        <script>
          async function handleClick() {
            const btn = document.querySelector('#slow-button');
            btn.textContent = 'loading...';
            setTimeout(() => btn.textContent = 'work done', window.slowMutationTimeout || 2000);
          }
        </script>
      </body>
    `);
    await use(page);
  },
});

test("slow button succeeds when there's a spinner", async ({ page }) => {
  await page.getByText("start work").click();
  await page.getByText("work done").waitFor();
});

test("visible disabled button succeeds when there's a spinner", async ({ page }) => {
  await page.setContent(`
    <button
      disabled
      onclick="document.querySelector('#result').textContent = 'approval submitted'"
    >Submit approval</button>
    <div data-spinner="true">Processing approval...</div>
    <div id="result"></div>
    <script>
      setTimeout(() => {
        document.querySelector('button').disabled = false;
        document.querySelector('[data-spinner="true"]').remove();
      }, 2000);
    </script>
  `);

  await page.getByRole("button", { name: "Submit approval" }).click();

  await page.locator("#result", { hasText: "approval submitted" }).waitFor();
});

test("slow button fails without spinner waiter", async ({ page }) => {
  spinnerWaiter.settings.enterWith({ disabled: true });
  await page.getByText("start work").click();
  const error = await page.getByText("work done").waitFor().catch((e) => e);
  expect(error.message).toMatch(/Timeout .* exceeded/);
});

test("slow button fails when spinner doesn't match selector", async ({ page }) => {
  await page.evaluate(() => Object.assign(window, { slowMutationTimeout: 6000 }));
  spinnerWaiter.settings.enterWith({
    spinnerSelectors: [".myCustomSpinnerClass"],
  });
  await page.getByText("start work").click();
  const error = await page.getByText("work done").waitFor().catch((e) => e);
  expect(error.message).toMatch(/Timeout .* exceeded/);
  expect(error.message).toMatch(/If this is a slow operation.../);
});

test("fails before a late spinner can make the no-spinner hint misleading", async ({ page }) => {
  await page.setContent(`
    <button id="start" onclick="
      const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      Promise.resolve().then(async () => {
        await sleep(1500);
        document.querySelector('#spinner').hidden = false;
        await sleep(1500);
        document.querySelector('#spinner').hidden = true;
        document.querySelector('#result').textContent = 'operation complete';
      });
    ">start operation</button>
    <div id="spinner" aria-label="Loading" hidden>Loading...</div>
    <div id="result"></div>
  `);

  await page.locator("#start").click();

  const start = Date.now();
  const error = await page.getByText("operation complete").waitFor().catch((e: Error) => e);
  const elapsed = Date.now() - start;

  expect(error).toBeInstanceOf(Error);
  expect(error?.message).toMatch(/If this is a slow operation.../);
  expect(elapsed).toBeLessThan(1500); // we don't tolerate the spinner taking a long time to appear
});

base("no-spinner fast fail still runs later middleware", async ({ page: basePage }, testInfo) => {
  const calls: string[] = [];
  const afterSpinner: Plugin = {
    name: "after-spinner",
    middleware: async (_ctx, next) => {
      calls.push("before");
      try {
        return await next();
      } finally {
        calls.push("after");
      }
    },
  };
  await using page = await addPlugins({
    page: basePage,
    testInfo,
    plugins: [spinnerWaiter(), afterSpinner],
  });
  await page.setContent(`<button disabled>Submit approval</button>`);

  const error = await page
    .getByRole("button", { name: "Submit approval" })
    .click()
    .catch((e: Error) => e);

  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toMatch(/If this is a slow operation/);
  expect(calls).toEqual(["before", "after"]);
});

test("slow button fails when spinner times out", async ({ page }) => {
  await page.evaluate(() => Object.assign(window, { slowMutationTimeout: 6000 }));
  spinnerWaiter.settings.enterWith({ spinnerTimeout: 3001 });
  await page.getByText("start work").click();
  const error = await page.getByText("work done").waitFor().catch((e) => e);
  expect(error.message).toMatch(/Timeout .* exceeded/);
  expect(error.message).toMatch(/spinner was still visible after .*/i);
});

test("settings.run scopes an override to a single call", async ({ page }) => {
  await page.getByText("start work").click();

  // Disabled just for this call — fails fast instead of waiting out the spinner
  const error = await spinnerWaiter.settings.run({ disabled: true }, async () => {
    return await page.getByText("work done").waitFor().catch((e) => e);
  });
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toMatch(/Timeout .* exceeded/);

  // Outside the run() scope the spinner waiter is back, so this succeeds
  await page.getByText("work done").waitFor();
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
