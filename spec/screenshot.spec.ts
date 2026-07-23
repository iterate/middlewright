import { statSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { addPlugins, screenshot } from "../src/index.ts";

test("saves matching successful actions under readable locator names", async ({ page }, testInfo) => {
  using _environment = environmentVariable("PLAYWRIGHT_SCREENSHOT", "getByText;getByRole");
  await using plugged = await addPlugins({ page, testInfo, plugins: [screenshot()] });
  await plugged.setContent(`<a href="#dashboard">dynamic-project-slug</a>`);

  await plugged.getByRole("link", { name: "dynamic-project-slug" }).waitFor();
  await plugged.getByRole("link", { name: "dynamic-project-slug" }).waitFor();

  expect(testInfo.attachments).toMatchObject([
    {
      contentType: "image/png",
      name: "getbyrole-link-name-dynamic-project-slug",
      path: expect.any(String),
    },
    {
      contentType: "image/png",
      name: "getbyrole-link-name-dynamic-project-slug-2",
      path: expect.any(String),
    },
  ]);
  expect(
    statSync(testInfo.outputPath("getbyrole-link-name-dynamic-project-slug.png")).size,
  ).toBeGreaterThan(0);
  expect(
    statSync(testInfo.outputPath("getbyrole-link-name-dynamic-project-slug-2.png")).size,
  ).toBeGreaterThan(0);
});

test("does not overwrite a screenshot from another page in the same test", async ({
  context,
  page,
}, testInfo) => {
  using _environment = environmentVariable("PLAYWRIGHT_SCREENSHOT", "getByRole");
  await using firstPage = await addPlugins({ page, testInfo, plugins: [screenshot()] });
  await using secondPage = await addPlugins({
    page: await context.newPage(),
    testInfo,
    plugins: [screenshot()],
  });
  await firstPage.setContent(`<button>Save</button>`);
  await secondPage.setContent(`<button>Save</button>`);

  await firstPage.getByRole("button", { name: "Save" }).waitFor();
  await secondPage.getByRole("button", { name: "Save" }).waitFor();

  expect(testInfo.attachments).toMatchObject([
    { name: "getbyrole-button-name-save" },
    { name: "getbyrole-button-name-save-2" },
  ]);
});

test("does not capture a failed matching action", async ({ page }, testInfo) => {
  using _environment = environmentVariable("PLAYWRIGHT_SCREENSHOT", "missing");
  await using plugged = await addPlugins({ page, testInfo, plugins: [screenshot()] });
  await plugged.setContent(`<main>Nothing matching the locator</main>`);

  const error = await plugged
    .locator("#missing")
    .waitFor()
    .catch((caught: Error) => caught);

  expect(error).toBeInstanceOf(Error);
  expect(testInfo.attachments).toEqual([]);
});

test("is inert when PWDEBUG is set", async ({ page }, testInfo) => {
  using _environment = environmentVariable("PLAYWRIGHT_SCREENSHOT", ".*");
  using _debug = environmentVariable("PWDEBUG", "1");
  await using plugged = await addPlugins({ page, testInfo, plugins: [screenshot()] });
  await plugged.setContent(`<button>Save</button>`);

  await plugged.getByRole("button", { name: "Save" }).click();

  expect(testInfo.attachments).toEqual([]);
});

test("identifies an invalid matcher by position", () => {
  using _environment = environmentVariable("PLAYWRIGHT_SCREENSHOT", "getByRole;[");

  expect(() => screenshot()).toThrow("Invalid PLAYWRIGHT_SCREENSHOT regex at position 2: [");
});

const environmentVariable = (name: string, value: string) => {
  const previous = process.env[name];
  process.env[name] = value;
  return {
    [Symbol.dispose]: () => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    },
  };
};
