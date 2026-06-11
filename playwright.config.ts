import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "spec",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  use: {
    // Aggressively low on purpose: these tests exercise how the plugins behave
    // when actions are slower than the action timeout.
    actionTimeout: 1_000,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
