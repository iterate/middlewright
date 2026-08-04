import * as fs from "node:fs";
import * as path from "node:path";
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { addPlugins, llmRecover, type LlmRecoverOptions } from "../src/index.ts";

// --- Provider-injected tests (no API key needed, always run) ---

test("recovers using the injected provider and records a soft failure", async ({
  page: basePage,
}, testInfo) => {
  const { page, assertions } = await plug(basePage, testInfo, {
    requestRecoveryCode: async () => ({
      code: `async function recover({ page }) { await page.getByText("Create your profile").click(); }`,
      description: "stale copy: the button says 'Create your profile'",
    }),
  });
  await page.setContent(getProfilePageHtml());

  // Stale copy — the button actually says "Create your profile"
  await page.getByText("Create profile").click();

  // The injected recovery code found and clicked the real button
  await page.getByText("profile created").waitFor();

  expect(assertions).toHaveLength(1);
  expect(assertions[0]).toMatch(/click failed and was recovered by LLM/);
  expect(assertions[0]).toMatch(/Create your profile/);
});

test("accepts recovery functions with a trailing semicolon", async ({
  page: basePage,
}, testInfo) => {
  const { page } = await plug(basePage, testInfo, {
    requestRecoveryCode: async () => ({
      code: `async function recover({ page }) { await page.getByText("Create your profile").click(); };`,
      description: "stale copy with statement-style generated code",
    }),
  });
  await page.setContent(getProfilePageHtml());

  await page.getByText("Create profile").click();

  await page.getByText("profile created").waitFor();
});

test("retries with attempt history, then rethrows with a summary", async ({
  page: basePage,
}, testInfo) => {
  const historySizes: number[] = [];
  const { page } = await plug(basePage, testInfo, {
    maxAttempts: 2,
    requestRecoveryCode: async (_context, attemptHistory) => {
      historySizes.push(attemptHistory.length);
      return {
        code: `async function recover() { throw new Error("recovery attempt went nowhere"); }`,
        description: "a bad idea, twice",
      };
    },
  });
  await page.setContent(`<div>no buttons here</div>`);

  const error = await page
    .getByText("Create profile")
    .click()
    .catch((e: Error) => e);

  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toMatch(/2 recovery attempt\(s\) failed/);
  expect((error as Error).message).toMatch(/recovery attempt went nowhere/);
  // The provider saw the failed attempts accumulate
  expect(historySizes).toEqual([0, 1]);

  // An artifact was written for post-mortem analysis
  const artifactDir = path.join(testInfo.outputDir, "llm-recover");
  const artifacts = fs.readdirSync(artifactDir);
  expect(artifacts.length).toBeGreaterThan(0);
  const artifact = JSON.parse(fs.readFileSync(path.join(artifactDir, artifacts[0]), "utf8"));
  expect(artifact).toMatchObject({ recovered: false, method: "click" });
});

test("provider returning no code rethrows the original error", async ({ page: basePage }, testInfo) => {
  const { page, assertions } = await plug(basePage, testInfo, {
    requestRecoveryCode: async () => ({
      code: null,
      description: "Not recoverable: this page has no profile creation at all.",
    }),
  });
  await page.setContent(`<div>no buttons here</div>`);

  const error = await page
    .getByText("Create profile")
    .click()
    .catch((e: Error) => e);

  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toMatch(/Timeout .* exceeded/);
  expect((error as Error).message).toMatch(/returned no code: Not recoverable/);
  expect(assertions).toHaveLength(0);
});

// --- Real Anthropic API tests (opt-in: set LLM_RECOVER + ANTHROPIC_API_KEY) ---
// These validate that the prompt actually works against the live model.

const apiTest = process.env.LLM_RECOVER ? test : test.skip;

apiTest("recovers from out-of-date copy", async ({ page: basePage }, testInfo) => {
  const { page, assertions } = await plug(basePage, testInfo, {});
  await page.setContent(getProfilePageHtml());

  // The test uses stale copy — button actually says "Create your profile"
  await page.getByText("Create profile").click();

  // Recovery should have found and clicked the real button
  await page.getByText("profile created").waitFor();

  expect(assertions).toHaveLength(1);
  expect(assertions[0]).toMatch(/click failed and was recovered by LLM/);
  const flat = assertions[0].replace(/\n\s*/g, " ").replaceAll(`"`, `'`);
  expect(flat).toMatch(/Original locator: await page.getByText\('Create profile'\)\.click\(\)/);
  // The exact locator style varies by model (getByText vs getByRole), but the
  // recovery must target the real button copy
  expect(flat).toMatch(/Recovery code: await page\.getBy\w+\(.*'Create your profile'.*\)\.click\(\)/);
});

apiTest("recovers from timing issue by waiting", async ({ page: basePage }, testInfo) => {
  const { page, assertions } = await plug(basePage, testInfo, {});
  await page.setContent(`
    <body>
      <h1>Welcome</h1>
      <p>You'll be able to create your profile in five seconds - hang tight</p>
      <div id="waiting-area"></div>
      <div id="result"></div>
      <script>
        setTimeout(function() {
          document.getElementById('waiting-area').innerHTML =
            '<button id="create-btn">Create profile</button>';
          document.getElementById('create-btn').addEventListener('click', function() {
            document.getElementById('result').textContent = 'profile created';
          });
        }, 5000);
      </script>
    </body>
  `);

  // Button doesn't exist yet — appears after 5s
  await page.getByText("Create profile").click();

  // Recovery should have waited and then clicked
  await page.getByText("profile created").waitFor();

  expect(assertions).toHaveLength(1);
  expect(assertions[0]).toMatch(/click failed and was recovered by LLM/);
});

apiTest("rethrows with context for genuine error", async ({ page: basePage }, testInfo) => {
  const { page } = await plug(basePage, testInfo, {});
  await page.setContent(`
    <body>
      <h1>Welcome</h1>
      <p>Creating profile not allowed for preview users</p>
    </body>
  `);

  await expect(async () => {
    await page.getByText("Create profile").click();
  }).rejects.toThrow(/Not recoverable/i);
});

// --- helpers ---

/** Add the llm-recover plugin with a shimmed `expect.soft` that records instead of failing. */
async function plug(basePage: Page, testInfo: TestInfo, options: LlmRecoverOptions) {
  const assertions: string[] = [];
  const mockExpectSoft = (actual: unknown, message: string) => {
    return {
      toBe: (expected: unknown) => {
        assertions.push(`Soft assertion ${actual}!=${expected}: ${message}`);
      },
    };
  };
  const shimmedExpect = Object.assign((...args: any[]) => expect(...(args as [string])), {
    ...expect,
    soft: mockExpectSoft,
  }) as typeof expect;

  const page = await addPlugins({
    page: basePage,
    testInfo,
    plugins: [llmRecover({ expect: shimmedExpect, ...options })],
  });
  return { page, assertions };
}

function getProfilePageHtml() {
  return `
    <body>
      <h1>Welcome</h1>
      <button id="create-btn">Create your profile</button>
      <div id="result"></div>
      <script>
        document.getElementById('create-btn').addEventListener('click', function() {
          document.getElementById('result').textContent = 'profile created';
        });
      </script>
    </body>
  `;
}
