import { test as base, expect } from "@playwright/test";
import { addPlugins, defaultSelectors, spinnerWaiter, type Plugin } from "../src/index.ts";

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

test("waits out a loading state showing two spinners at once", async ({ page }) => {
  // Mirrors a chat feed's live "Thinking…" state: a spinner icon and a
  // thinking bubble both match the spinner selectors at the same time. A bare
  // spinnerLocator.isVisible() throws a strict-mode violation here.
  await page.setContent(`
    <button id="ask" onclick="think()">ask question</button>
    <div id="feed"></div>
    <script>
      function think() {
        const feed = document.querySelector('#feed');
        feed.innerHTML = '<span aria-label="Loading">⏳</span><p>Thinking…</p>';
        setTimeout(() => { feed.textContent = 'here is your answer'; }, 2000);
      }
    </script>
  `);

  await page.locator("#ask").click();

  const spinners = page.locator(defaultSelectors.join(","));
  expect(await spinners.count()).toBeGreaterThanOrEqual(2); // multiple matches, or the test is vacuous

  await page.getByText("here is your answer").waitFor();
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

test("an explicit timeout is honored instead of the 1ms fast-fail", async ({ page }) => {
  // The element appears after 2.5s with NO spinner — normally the fast-fail
  // path (the "add a spinner" nudge). An explicit timeout is the author's
  // owned budget for exactly this shape (auth pages without loading UI), so
  // the action passes through and playwright waits it out.
  await page.setContent(`
    <div id="slot"></div>
    <script>
      setTimeout(() => {
        document.querySelector('#slot').innerHTML = '<button onclick="this.textContent = \\'consented\\'">Allow access</button>';
      }, 2500);
    </script>
  `);
  // timeout: deliberate spinner-waiter escape hatch — the pass-through under test
  await page.getByRole("button", { name: "Allow access" }).click({ timeout: 15_000 });
  await page.getByText("consented").waitFor();
});

test("an exceeded explicit timeout still fails with its own budget, not 1ms", async ({ page }) => {
  await page.setContent(`<div id="empty"></div>`);
  const start = Date.now();
  const error = await page
    .getByRole("button", { name: "Never appears" })
    // timeout: deliberate spinner-waiter escape hatch — the pass-through under test
    .click({ timeout: 2000 })
    .catch((e: Error) => e);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toMatch(/Timeout 2000ms exceeded/);
  expect(Date.now() - start).toBeGreaterThan(1500);
});

test("disappearance waits pass through untouched", async ({ page }) => {
  // waitFor({ state: "detached" | "hidden" }) waits for the target to LEAVE —
  // spinner-waiter's appear-oriented model doesn't apply, so those waits get
  // vanilla Playwright behavior: a satisfied wait resolves (no 1ms fast-fail
  // aborting it), an unsatisfied one fails on the normal action timeout.
  await page.setContent(`
    <div id="banner">temporary banner</div>
    <div id="fixture">permanent fixture</div>
    <script>
      setTimeout(() => document.querySelector('#banner').remove(), 500);
    </script>
  `);

  await page.getByText("temporary banner").waitFor({ state: "hidden" });

  const start = Date.now();
  const error = await page
    .getByText("permanent fixture")
    .waitFor({ state: "hidden" })
    .catch((e: Error) => e);
  expect(error).toBeInstanceOf(Error);
  // The configured 1s actionTimeout, not spinner-waiter's 1ms fast-fail.
  expect(String(error)).toContain("Timeout 1000ms exceeded");
  expect(Date.now() - start).toBeGreaterThan(500);
});
