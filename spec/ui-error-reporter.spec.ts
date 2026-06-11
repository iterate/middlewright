import { test, expect } from "@playwright/test";
import { addPlugins, uiErrorReporter } from "../src/index.ts";

test("appends visible error UI to failing action errors", async ({ page }, testInfo) => {
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [uiErrorReporter()],
  });
  await plugged.setContent(`
    <button id="save">save</button>
    <div id="toasts"></div>
    <script>
      document.getElementById('save').addEventListener('click', () => {
        const toast = document.createElement('div');
        toast.setAttribute('data-type', 'error');
        toast.textContent = 'Could not save: quota exceeded';
        document.getElementById('toasts').appendChild(toast);
      });
    </script>
  `);

  await plugged.locator("#save").click();
  // The save "failed" (error toast appeared), so this element never shows up
  const error = await plugged
    .locator("#saved-indicator")
    .waitFor()
    .catch((e: Error) => e);

  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toMatch(/Error UI visible/);
  expect((error as Error).message).toMatch(/quota exceeded/);
});

test("leaves errors alone when no error UI is visible", async ({ page }, testInfo) => {
  await using plugged = await addPlugins({
    page,
    testInfo,
    plugins: [uiErrorReporter()],
  });
  await plugged.setContent(`<div>nothing to see here</div>`);

  const error = await plugged
    .locator("#missing")
    .waitFor()
    .catch((e: Error) => e);

  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).not.toMatch(/Error UI visible/);
});
