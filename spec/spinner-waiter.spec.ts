import http from "node:http";
import type { AddressInfo } from "node:net";
import { test as base, expect, selectors } from "@playwright/test";
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

test("inputValue waits for a loading composer and returns its value", async ({ page }) => {
  await page.setContent(`
    <p data-spinner="true">Opening chat…</p>
    <script>
      setTimeout(() => {
        document.body.innerHTML = '<textarea aria-label="Message">About my edited note</textarea>';
      }, 2000);
    </script>
  `);
  expect(await page.getByLabel("Message").inputValue()).toBe("About my edited note");
});

test("inputValue preserves an explicit timeout and can read disabled inputs", async ({ page }) => {
  await page.setContent('<input aria-label="Saved note" disabled value="green apples">');
  expect(await page.getByLabel("Saved note").inputValue()).toBe("green apples");
  await page.setContent('<p data-spinner="true">Opening chat…</p>');
  // Explicit timeout must bypass spinner-waiter even while progress is visible.
  await expect(page.getByLabel("Missing").inputValue({ timeout: 100 })).rejects.toThrow(
    /Timeout 100ms exceeded/,
  );
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

base(
  "a control becoming ready during the loading check keeps its normal action budget",
  async ({ page: basePage }, testInfo) => {
    // Finish the UI update exactly when loading is checked, after the initial
    // readiness check. The selector controls scheduling; the click is real.
    await selectors.register("complete_spinner", () => ({
      query: () => null,
      queryAll(root: Document | Element) {
        root.querySelector("button")?.removeAttribute("disabled");
        root.querySelector("#spinner")?.remove();
        return [];
      },
    }));
    await using page = await addPlugins({
      page: basePage,
      testInfo,
      plugins: [spinnerWaiter({ spinnerSelectors: ["complete_spinner=now"] })],
    });
    await page.setContent(`
    <button disabled onclick="this.textContent = 'submitted'">Submit</button>
    <p id="spinner">Loading…</p>
  `);
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    await page.getByRole("button", { name: "submitted", exact: true }).waitFor();
  },
);

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

test("waits while a freshly navigated document is still loading, with no spinner", async ({
  page,
}) => {
  // A cross-server hop lands on a page that renders its UI on `load`, and a
  // slow subresource keeps `load` 2.5s away. The app draws no spinner — the
  // browser's own tab spinner is the only loading UI. Playwright itself waits
  // for the navigation to commit; spinner-waiter must keep waiting until the
  // document finishes loading instead of fast-failing at commit.
  await page.route("https://app.middlewright.test/**", async (route) => {
    await route.fulfill({ body: `<h1>middlewright dashboard</h1>`, contentType: "text/html" });
  });
  await page.route("https://auth.middlewright.test/slow.png", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await route.fulfill({ body: Buffer.alloc(0), contentType: "image/png" });
  });
  await page.route("https://auth.middlewright.test/consent", async (route) => {
    await route.fulfill({
      body: `
        <img src="https://auth.middlewright.test/slow.png" alt="" />
        <script>
          window.addEventListener("load", () => {
            document.body.insertAdjacentHTML("beforeend", '<button id="allow">Allow access</button>');
          });
        </script>
      `,
      contentType: "text/html",
    });
  });
  await page.goto("https://app.middlewright.test/");
  // Kick the hop off without a Playwright action waiting on it, the way a
  // popup arrives already navigating.
  await page.evaluate(() => {
    location.assign("https://auth.middlewright.test/consent");
  });

  await page.getByRole("button", { name: "Allow access" }).click();
});

test("fails fast once a navigation has fully loaded without the expected element", async ({
  page,
}) => {
  await page.route("https://app.middlewright.test/**", async (route) => {
    await route.fulfill({ body: `<h1>middlewright dashboard</h1>`, contentType: "text/html" });
  });
  await page.route("https://auth.middlewright.test/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.fulfill({ body: `<h1>Something went wrong</h1>`, contentType: "text/html" });
  });
  await page.goto("https://app.middlewright.test/");
  await page.evaluate(() => {
    location.assign("https://auth.middlewright.test/consent");
  });

  const start = Date.now();
  const error = await page
    .getByRole("button", { name: "Allow access" })
    .click()
    .catch((e: Error) => e);

  // The navigation is over and the document is complete: nothing is loading,
  // so this is the ordinary no-spinner fast-fail — not a long wait. When the
  // commit lands inside the quick check, the new document gets one more
  // second first.
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).toMatch(/Timeout 1ms exceeded/);
  expect(String(error)).toMatch(/add a spinner/i);
  expect(Date.now() - start).toBeLessThan(6_000);
});

test("waits through a redirect chain whose landing page draws its spinner after it commits", async ({
  page,
}) => {
  // A Connect button first creates the integration over fetch (no loading UI
  // of its own), then follows a server redirect chain the way an OAuth
  // connection does: consent, callback, project page. The project page
  // commits inside spinner-waiter's 1s quick check and draws its loading
  // state 850ms after that (a data fetch after hydration), then the result.
  //
  // From the click, in ms: fetch resolves ~400, consent 302 ~550, callback
  // 302 ~700, project page commits ~750, spinner ~1600, result ~3250. The
  // quick check spends most of its second on the page the click left, so the
  // loading check runs ~1050ms in: the project page is complete and has not
  // drawn its spinner yet. Unless the new document gets a quick check of its
  // own, that reads as "nothing loading" and fast-fails at 1ms mid-flow.
  // (A very slow runner can shift that ordering so the old code passes too;
  // the fix passes in every ordering.)
  await using app = await serveConnectFlow();
  await page.goto(app.url);
  await page
    .getByRole("button", { name: "Connect GitHub" })
    // noWaitAfter: the click must not wait for a navigation it sets off.
    .click({ noWaitAfter: true });
  await page.getByText("GitHub connected").waitFor();
});

test("gives up on a page that keeps navigating and blames the navigation", async ({ page }) => {
  // A page that reloads itself every 300ms never gives the target a chance
  // and never shows a spinner. Each navigation would buy the new document
  // another quick check; the deadline (spinnerTimeout minus the action's
  // last second) stops that and reports a navigation still in flight instead
  // of the no-spinner hint.
  await page.route("https://app.middlewright.test/**", async (route) => {
    await route.fulfill({
      body: `<h1>Reload loop</h1><script>setTimeout(() => location.reload(), 300)</script>`,
      contentType: "text/html",
    });
  });
  await page.goto("https://app.middlewright.test/");
  spinnerWaiter.settings.enterWith({ spinnerTimeout: 3001 });

  const start = Date.now();
  const error = await page.getByText("Settled").waitFor().catch((e: Error) => e);

  expect(error).toBeInstanceOf(Error);
  expect(String(error)).toMatch(/navigation was still in flight/);
  expect(Date.now() - start).toBeLessThan(6_000);
});

/**
 * A tiny app on 127.0.0.1 whose Connect button creates the integration over
 * fetch and then follows the OAuth-style redirect chain consent → callback →
 * project page. Real HTTP, because Chromium follows a route-fulfilled 302
 * without passing the next hop back through page.route.
 */
async function serveConnectFlow() {
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const pages: Record<string, string> = {
    "/": `
      <button id="connect">Connect GitHub</button>
      <script>
        document.querySelector("#connect").addEventListener("click", async () => {
          const response = await fetch("/api/connect", { method: "POST" });
          location.assign((await response.json()).url);
        });
      </script>
    `,
    "/project": `
      <h1>Project</h1>
      <div id="integrations"></div>
      <script>
        const integrations = document.querySelector("#integrations");
        setTimeout(() => { integrations.innerHTML = '<p aria-label="Loading">Loading integrations…</p>'; }, 850);
        setTimeout(() => { integrations.textContent = "GitHub connected"; }, 2500);
      </script>
    `,
  };
  const server = http.createServer(async (request, response) => {
    const { pathname } = new URL(request.url ?? "/", "http://127.0.0.1");
    if (pathname === "/api/connect") {
      await delay(400);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ url: "/oauth/consent" }));
    } else if (pathname === "/oauth/consent") {
      await delay(150);
      response.writeHead(302, { location: "/oauth/callback?code=1" }).end();
    } else if (pathname === "/oauth/callback") {
      await delay(150);
      response.writeHead(302, { location: "/project" }).end();
    } else if (pathname in pages) {
      response.setHeader("content-type", "text/html");
      response.end(pages[pathname]);
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    [Symbol.asyncDispose]: async () => {
      const closed = new Promise((resolve) => server.close(resolve));
      server.closeAllConnections();
      await closed;
    },
  };
}
