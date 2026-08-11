## Timeouts

Keep the default `actionTimeout` aggressive and short. If an operation is slow, fix it or add loading UI for users; `spinnerWaiter` then extends the wait only while that progress is visible. Keep an explicit action timeout only when a product or Middlewright limit makes spinner-based waiting impossible, and explain that limit beside the timeout. See [Don't fix slow tests with longer timeouts](https://github.com/iterate/middlewright#dont-fix-slow-tests-with-longer-timeouts).

## Locators over `expect`

Avoid using the expect-based API for asserting that UI is visible/in a particular state. For example, don't bother with `await expect(page.getByRole("button", { name: "Run" })).toBeEnabled()` before clicking a button. Just call `await page.getByRole("button", { name: "Run" }).click()` directly. The `.click` implementation already waits for the button to exist, be visible, and to be enabled. Similarly if you want to assert that something is present on the page you can just do `await page.getByText("Welcome").waitFor()`. No need for any `await expect(...).toBeVisible()` rubbish. Similarly, no stupid assertions like `await expect(page.getByText("Receipt ready")).toContainText("Receipt ready");`. Just use `await page.getByText("Receipt ready").waitFor()`.

Avoid using `timeout` for actions like `click` and `waitFor`: `.waitFor({ timeout: 5_000 })`.

Avoid doing `await myButton.waitFor()` and then `await runButton.click()`. It's another code-smell. `.click()` should _already_ wait for the button to be clickable so the `.waitFor()` is doing nothing other than give you another chance to run the test and hope for the flake gods to smile on you this time.

Avoid `.waitFor({ state: "detached" })`. Absence is ambiguous: the intended action may have worked, or the app may be showing the wrong page or an error. Wait for explicit result, empty-state, or error UI instead. If the product has no observable outcome, add one for users and tests.


## Error UI

For common developer pitfalls, instead of littering your test code with defensive try/catch statements and custom selectors for app error UI, just add the `data-type="error"` attribute to relevant UI elements. Then, the `ui-error-reporter` plugin will pick up any errors on screen automatically (including toasts rendered using the `sonner` library). The plugin will find elements annotated in this way and include their text content in error reports, so agents and humans will quickly be able to get an indication of what went wrong.
