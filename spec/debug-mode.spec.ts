import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  addPlugins,
  hydrationWaiter,
  llmRecover,
  spinnerWaiter,
  uiErrorReporter,
  videoMode,
} from "../src/index.ts";

test("action middleware plugins are inert when PWDEBUG is set", async ({ page }, testInfo) => {
  using _debug = withPwdebug();
  let recoveryCalls = 0;

  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [
      llmRecover({
        requestRecoveryCode: async () => {
          recoveryCalls += 1;
          return null;
        },
      }),
      hydrationWaiter({ timeout: 200 }),
      uiErrorReporter(),
      spinnerWaiter({ spinnerTimeout: 3001 }),
    ],
  });
  await plugged.setContent(`
    <div data-hydrated="false">hydrating forever</div>
    <div data-type="error">Exploded visibly</div>
    <button disabled>Submit approval</button>
    <div aria-label="Loading">Loading...</div>
  `);

  const start = Date.now();
  const error = await plugged
    .getByRole("button", { name: "Submit approval" })
    .click({ timeout: 100 })
    .catch((e: Error) => e);

  expect(Date.now() - start).toBeLessThan(500);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain("Timeout 100ms exceeded");
  expect((error as Error).message).not.toContain("Error UI visible");
  expect((error as Error).message).not.toContain("If this is a slow operation");
  expect(recoveryCalls).toBe(0);
});

test("videoMode controls are inert when PWDEBUG is set", async ({ page }, testInfo) => {
  using _debug = withPwdebug();

  const plugged = await addPlugins({
    page,
    testInfo,
    plugins: [videoMode({ finalHold: 50, highlight: { mode: "pointer", duration: 20 } })],
  });
  await plugged.setContent(`<button>press</button>`);

  plugged.videoMode.setStartTime();
  await plugged.videoMode.deadAir(async () => {
    await plugged.waitForTimeout(20);
  });
  await plugged.getByRole("button", { name: "press" }).click();
  plugged.videoMode.setEndTime();

  await expect(plugged.videoMode.metadata()).resolves.toMatchObject({
    deadAir: [],
    highlights: [],
    outputs: {},
    sourceRange: {},
  });
  expect(plugged.videoMode.getVideoTimestamp()).toBe(0);

  await plugged[Symbol.asyncDispose]();
  expect(existsSync(join(testInfo.outputDir, "video-mode.json"))).toBe(false);
});

function withPwdebug() {
  const previous = process.env.PWDEBUG;
  process.env.PWDEBUG = "1";

  return {
    [Symbol.dispose]: () => {
      if (previous === undefined) {
        delete process.env.PWDEBUG;
        return;
      }

      process.env.PWDEBUG = previous;
    },
  };
}
