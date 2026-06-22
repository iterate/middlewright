import { test, expect } from "@playwright/test";
import { addPlugins, adjustError, type Plugin } from "../src/index.ts";

test("middleware wraps actions in registration order", async ({ page }, testInfo) => {
  const calls: string[] = [];
  const tracer = (name: string): Plugin => ({
    name,
    middleware: async (ctx, next) => {
      calls.push(`${name}:before:${ctx.method}`);
      const result = await next();
      calls.push(`${name}:after:${ctx.method}`);
      return result;
    },
  });

  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [tracer("outer"), tracer("inner")],
  });
  await plugged.setContent(`<input id="name">`);

  await plugged.locator("#name").fill("hello");

  expect(await plugged.locator("#name").inputValue()).toBe("hello");
  expect(calls).toEqual([
    "outer:before:fill",
    "inner:before:fill",
    "inner:after:fill",
    "outer:after:fill",
  ]);
});

test("falsy entries in the plugins array are skipped", async ({ page }, testInfo) => {
  const calls: string[] = [];
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [
      false,
      null,
      undefined,
      { name: "real", middleware: async (ctx, next) => (calls.push(ctx.method), next()) },
    ],
  });
  await plugged.setContent(`<button onclick="this.textContent = 'clicked'">click me</button>`);

  await plugged.locator("button").click();

  expect(calls).toEqual(["click"]);
});

test("middleware receives testInfo", async ({ page }, testInfo) => {
  let seenTitle: string | undefined;
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [
      {
        name: "test-info-spy",
        middleware: async (ctx, next) => {
          seenTitle = ctx.testInfo.title;
          return next();
        },
      },
    ],
  });
  await plugged.setContent(`<button>hi</button>`);

  await plugged.locator("button").click();

  expect(seenTitle).toBe("middleware receives testInfo");
});

test("middleware receives action timing", async ({ page }, testInfo) => {
  let seenTiming: any;
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [
      {
        name: "timing-spy",
        middleware: async (ctx, next) => {
          seenTiming = ctx.timing;
          return next();
        },
      },
    ],
  });
  await plugged.setContent(`<button>hi</button>`);

  await plugged.locator("button").click();

  expect(seenTiming).toMatchObject({
    actionStartedAt: expect.any(Number),
    attachedAt: expect.any(Number),
    attachedAtStart: true,
    middlewares: [
      expect.objectContaining({
        endedAt: expect.any(Number),
        name: "timing-spy",
        startedAt: expect.any(Number),
      }),
    ],
  });
});

test("plugins can expose typed controls on the plugged page", async ({ page }, testInfo) => {
  const helper = {
    name: "page-helper",
    pageExtension: ({ page, testInfo }) => ({
      pageHelper: {
        renderMessage: async (message: string) => {
          await page.setContent(`<main>${message}</main>`);
        },
        title: () => testInfo.title,
      },
    }),
  } satisfies Plugin<{
    pageHelper: {
      renderMessage(message: string): Promise<void>;
      title(): string;
    };
  }>;

  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [helper],
  });

  await plugged.pageHelper.renderMessage("hello from a page extension");

  await expect(plugged.locator("main")).toContainText("hello from a page extension");
  expect(plugged.pageHelper.title()).toBe("plugins can expose typed controls on the plugged page");
});

test("pages without plugins fall through to the original behavior", async ({
  page,
  context,
}, testInfo) => {
  // Adding plugins to one page patches the Locator prototype globally...
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [{ name: "noop", middleware: async (_ctx, next) => next() }],
  });
  await plugged.setContent(`<input>`);
  await plugged.locator("input").fill("plugged");

  // ...but a page that never had plugins added must still work.
  const plainPage = await context.newPage();
  await plainPage.setContent(`<input>`);
  await plainPage.locator("input").fill("unplugged");
  expect(await plainPage.locator("input").inputValue()).toBe("unplugged");
});

test("lifecycle events fire on addPlugins and on dispose", async ({ page }, testInfo) => {
  const events: string[] = [];
  const plugged = await addPlugins({
    page,
    testInfo,
    plugins: [
      {
        name: "lifecycle-spy",
        testLifecycle: (emitter) => {
          emitter.on("beforeTest", () => {
            events.push("beforeTest");
          });
          emitter.on("afterTest", () => {
            events.push("afterTest");
          });
          return () => events.push("cleanup");
        },
      },
    ],
  });

  expect(events).toEqual(["beforeTest"]);

  await plugged[Symbol.asyncDispose]();

  expect(events).toEqual(["beforeTest", "afterTest", "cleanup"]);
});

test("adjustError appends info and preserves the original message", () => {
  const error = new Error("Timeout 1000ms exceeded");
  adjustError(error, ["The app was probably still loading.", "Add a spinner."]);

  expect(error.message).toContain("Timeout 1000ms exceeded");
  expect(error.message).toContain("The app was probably still loading.");
  expect(error).toMatchObject({ originalMessage: "Timeout 1000ms exceeded" });
});

test("adjustError filters the given file from the stack trace", () => {
  const error = new Error("boom");
  error.stack = [
    "Error: boom",
    "    at doThing (/app/spec/my-test.spec.ts:10:5)",
    "    at middleware (/app/src/plugins/my-plugin.ts:42:3)",
  ].join("\n");

  adjustError(error, [], "my-plugin.ts");

  expect(error.stack).toContain("my-test.spec.ts");
  expect(error.stack).not.toContain("my-plugin.ts");
});
