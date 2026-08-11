import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test, expect } from "@playwright/test";

const execFileAsync = promisify(execFile);
const preferLocatorWaitsRules = { "middlewright/prefer-locator-waits": "error" };
const preferPositiveWaitsRules = { "middlewright/prefer-positive-waits": "error" };
const requireTimeoutCommentRules = { "middlewright/require-timeout-comment": "error" };

test("fixes visible locator assertions to locator waits", async () => {
  await using fixture = await lintFixture(
    `await expect(page.getByText("Ready")).toBeVisible();\n`,
    preferLocatorWaitsRules,
  );

  await execFileAsync("pnpm", [
    "exec",
    "oxlint",
    "--config",
    fixture.configPath,
    "--fix",
    fixture.sourcePath,
  ]);

  expect(await readFile(fixture.sourcePath, "utf8")).toBe(
    `await page.getByText("Ready").waitFor();\n`,
  );
});

test("fixes text locator assertions to filtered locator waits", async () => {
  await using fixture = await lintFixture(
    `await expect(page.getByRole("status")).toContainText("Receipt ready");\n`,
    preferLocatorWaitsRules,
  );

  await execFileAsync("pnpm", [
    "exec",
    "oxlint",
    "--config",
    fixture.configPath,
    "--fix",
    fixture.sourcePath,
  ]);

  expect(await readFile(fixture.sourcePath, "utf8")).toBe(
    `await page.getByRole("status").filter({ hasText: "Receipt ready" }).waitFor();\n`,
  );
});

test("parenthesizes locator expressions before appending methods", async () => {
  await using fixture = await lintFixture(
    [
      `await expect(page.locator("button") as Locator).toBeVisible();`,
      `await expect(ready ? first : second).toContainText("Ready");`,
      `await expect(await locatorPromise).toBeVisible();`,
      ``,
    ].join("\n"),
    preferLocatorWaitsRules,
  );

  await execFileAsync("pnpm", [
    "exec",
    "oxlint",
    "--config",
    fixture.configPath,
    "--fix",
    fixture.sourcePath,
  ]);

  expect(await readFile(fixture.sourcePath, "utf8")).toBe(
    [
      `await (page.locator("button") as Locator).waitFor();`,
      `await (ready ? first : second).filter({ hasText: "Ready" }).waitFor();`,
      `await (await locatorPromise).waitFor();`,
      ``,
    ].join("\n"),
  );
});

test("leaves unawaited matcher calls alone", async () => {
  await using fixture = await lintFixture(
    `expect(page.getByText("Ready")).toBeVisible();\n`,
    preferLocatorWaitsRules,
  );

  await execFileAsync("pnpm", [
    "exec",
    "oxlint",
    "--config",
    fixture.configPath,
    "--fix",
    fixture.sourcePath,
  ]);

  expect(await readFile(fixture.sourcePath, "utf8")).toBe(
    `expect(page.getByText("Ready")).toBeVisible();\n`,
  );
});

test("reports matcher options that cannot be fixed safely", async () => {
  const source = `await expect(page.getByText("Ready")).toContainText("Ready", { ignoreCase: true });\n`;
  await using fixture = await lintFixture(source, preferLocatorWaitsRules);

  const result = await execFileAsync("pnpm", [
    "exec",
    "oxlint",
    "--config",
    fixture.configPath,
    "--fix",
    fixture.sourcePath,
  ]).catch((error: any) => error);

  expect(result).toMatchObject({ code: 1 });
  expect(`${result.stdout}\n${result.stderr}`).toContain("middlewright(prefer-locator-waits)");
  expect(await readFile(fixture.sourcePath, "utf8")).toBe(source);
});

test("reports text lists without replacing them with an invalid filter", async () => {
  const source = `await expect(page.locator("li")).toContainText(["First", "Second"]);\n`;
  await using fixture = await lintFixture(source, preferLocatorWaitsRules);

  const result = await execFileAsync("pnpm", [
    "exec",
    "oxlint",
    "--config",
    fixture.configPath,
    "--fix",
    fixture.sourcePath,
  ]).catch((error: any) => error);

  expect(result).toMatchObject({ code: 1 });
  expect(`${result.stdout}\n${result.stderr}`).toContain("middlewright(prefer-locator-waits)");
  expect(await readFile(fixture.sourcePath, "utf8")).toBe(source);
});

test("reports detached waits without an explanation", async () => {
  const source = `await page.getByText("Florence").waitFor({ state: "detached" });\n`;
  await using fixture = await lintFixture(source, preferPositiveWaitsRules);

  const result = await execFileAsync("pnpm", [
    "exec",
    "oxlint",
    "--config",
    fixture.configPath,
    fixture.sourcePath,
  ]).catch((error: any) => error);

  expect(result).toMatchObject({ code: 1 });
  const output = `${result.stdout}\n${result.stderr}`;
  expect(output).toContain("Wait for positive UI instead of element detachment");
  expect(output).toContain(
    "https://github.com/iterate/middlewright#prefer-positive-waits-over-absence",
  );
  expect(await readFile(fixture.sourcePath, "utf8")).toBe(source);
});

test("allows detached waits with a nearby explanation", async () => {
  const source = [
    `// detached is intentional because the browser owns this transient element`,
    `await page.getByText("Exporting").waitFor({ state: "detached" });`,
    `await page.getByText("Importing").waitFor({ state: "detached" }); // DETACHED is the browser's completion signal`,
    ``,
  ].join("\n");
  await using fixture = await lintFixture(source, preferPositiveWaitsRules);

  await execFileAsync("pnpm", [
    "exec",
    "oxlint",
    "--config",
    fixture.configPath,
    fixture.sourcePath,
  ]);

  expect(await readFile(fixture.sourcePath, "utf8")).toBe(source);
});

test("uses configured detached-wait explanation patterns", async () => {
  const source = [
    `// browser-owned completion is only observable through removal`,
    `await page.getByText("Exporting").waitFor({ state: "detached" });`,
    ``,
  ].join("\n");
  await using fixture = await lintFixture(source, {
    "middlewright/prefer-positive-waits": [
      "error",
      { requiredPatterns: ["browser.?owned", "completion"] },
    ],
  });

  await execFileAsync("pnpm", [
    "exec",
    "oxlint",
    "--config",
    fixture.configPath,
    fixture.sourcePath,
  ]);

  expect(await readFile(fixture.sourcePath, "utf8")).toBe(source);
});

test("reports only direct static detached waitFor states", async () => {
  const source = [
    `await locator.waitFor({ state: "detached" });`,
    `await locator.waitFor({ "state": "detached" });`,
    `await locator.waitFor({ state });`,
    `await locator.waitFor({ state: "hidden" });`,
    `await locator.click({ state: "detached" });`,
    `await locator["waitFor"]({ state: "detached" });`,
    `await locator.waitFor_original({ state: "detached" });`,
    `await locator.waitFor({ ["state"]: "detached" });`,
    `await locator.waitFor({ nested: { state: "detached" } });`,
    `await locator.waitFor(options);`,
    ``,
  ].join("\n");
  await using fixture = await lintFixture(source, preferPositiveWaitsRules);

  const result = await execFileAsync("pnpm", [
    "exec",
    "oxlint",
    "--config",
    fixture.configPath,
    fixture.sourcePath,
  ]).catch((error: any) => error);

  expect(result).toMatchObject({ code: 1 });
  expect(`${result.stdout}\n${result.stderr}`.match(/middlewright\(prefer-positive-waits\)/g)).toHaveLength(
    2,
  );
  expect(await readFile(fixture.sourcePath, "utf8")).toBe(source);
});

test("reports timeout options without an explanation", async () => {
  const source = `await page.getByRole("button").click({ timeout: 10_000 });\n`;
  await using fixture = await lintFixture(source, requireTimeoutCommentRules);

  const result = await execFileAsync("pnpm", [
    "exec",
    "oxlint",
    "--config",
    fixture.configPath,
    fixture.sourcePath,
  ]).catch((error: any) => error);

  expect(result).toMatchObject({ code: 1 });
  const output = `${result.stdout}\n${result.stderr}`;
  expect(output).toContain("middlewright(require-timeout-comment)");
  expect(output).toContain("remove the timeout and add loading UI for spinnerWaiter");
  expect(output).toContain(
    "https://github.com/iterate/middlewright#dont-fix-slow-tests-with-longer-timeouts",
  );
  expect(await readFile(fixture.sourcePath, "utf8")).toBe(source);
});

test("requires timeout explanations to mention why the spinner waiter did not suffice", async () => {
  const source = [
    `// timeout is longer because the export runs asynchronously`,
    `await page.getByText("Export").click({ timeout: 10_000 });`,
    ``,
  ].join("\n");
  await using fixture = await lintFixture(source, requireTimeoutCommentRules);

  const result = await execFileAsync("pnpm", [
    "exec",
    "oxlint",
    "--config",
    fixture.configPath,
    fixture.sourcePath,
  ]).catch((error: any) => error);

  expect(result).toMatchObject({ code: 1 });
  expect(`${result.stdout}\n${result.stderr}`).toContain("middlewright(require-timeout-comment)");
  expect(await readFile(fixture.sourcePath, "utf8")).toBe(source);
});

test("uses configured explanation patterns instead of the defaults", async () => {
  const source = [
    `// timeout waits for network-idle because this page has no spinner`,
    `await page.getByText("Export").click({ timeout: 10_000 });`,
    ``,
  ].join("\n");
  await using fixture = await lintFixture(source, {
    "middlewright/require-timeout-comment": [
      "error",
      { requiredPatterns: ["timeout", "network.?idle"] },
    ],
  });

  await execFileAsync("pnpm", [
    "exec",
    "oxlint",
    "--config",
    fixture.configPath,
    fixture.sourcePath,
  ]);

  expect(await readFile(fixture.sourcePath, "utf8")).toBe(source);
});

test("allows timeout comments on the call line or the previous line", async () => {
  const source = [
    `// timeout is longer because spinner waiter cannot observe the export state`,
    `await page.getByText("Export").click({ timeout: 10_000 });`,
    `await page.getByText("Import").click({ timeout: 10_000 }); // TIMEOUT covers ingestion after SPINNER WAITER finishes`,
    ``,
  ].join("\n");
  await using fixture = await lintFixture(source, requireTimeoutCommentRules);

  await execFileAsync("pnpm", [
    "exec",
    "oxlint",
    "--config",
    fixture.configPath,
    fixture.sourcePath,
  ]);

  expect(await readFile(fixture.sourcePath, "utf8")).toBe(source);
});

test("does not reuse a trailing timeout comment for the next call", async () => {
  const source = [
    `await page.getByText("Export").click({ timeout: 10_000 }); // timeout is justified because spinner waiter cannot observe export state`,
    `await page.getByText("Import").click({ timeout: 10_000 });`,
    ``,
  ].join("\n");
  await using fixture = await lintFixture(source, requireTimeoutCommentRules);

  const result = await execFileAsync("pnpm", [
    "exec",
    "oxlint",
    "--config",
    fixture.configPath,
    fixture.sourcePath,
  ]).catch((error: any) => error);

  expect(result).toMatchObject({ code: 1 });
  expect(`${result.stdout}\n${result.stderr}`.match(/middlewright\(require-timeout-comment\)/g)).toHaveLength(
    1,
  );
  expect(await readFile(fixture.sourcePath, "utf8")).toBe(source);
});

test("allows timeout comments before a chained method with multiline options", async () => {
  const source = [
    `await page`,
    `  .getByText("Export")`,
    `  // timeout is needed because spinner waiter cannot observe the export state`,
    `  .click({`,
    `    timeout: 10_000,`,
    `  });`,
    ``,
  ].join("\n");
  await using fixture = await lintFixture(source, requireTimeoutCommentRules);

  await execFileAsync("pnpm", [
    "exec",
    "oxlint",
    "--config",
    fixture.configPath,
    fixture.sourcePath,
  ]);

  expect(await readFile(fixture.sourcePath, "utf8")).toBe(source);
});

test("allows timeout comments beside multiline timeout properties", async () => {
  const source = [
    `await page.getByText("Export").click({`,
    `  // timeout is longer because spinner waiter cannot observe the export state`,
    `  timeout: 10_000,`,
    `});`,
    `await page.getByText("Import").click({`,
    `  timeout: 10_000, // timeout covers ingestion after spinner-waiter finishes`,
    `});`,
    ``,
  ].join("\n");
  await using fixture = await lintFixture(source, requireTimeoutCommentRules);

  await execFileAsync("pnpm", [
    "exec",
    "oxlint",
    "--config",
    fixture.configPath,
    fixture.sourcePath,
  ]);

  expect(await readFile(fixture.sourcePath, "utf8")).toBe(source);
});

test("reports static timeout properties without guessing dynamic shapes", async () => {
  const source = [
    `await locator.click({ timeout });`,
    `await locator.fill("value", { "timeout": 1_000 });`,
    `/* timeout is explained in a block */`,
    `await locator.waitFor({ timeout: 1_000 });`,
    `// timeouts are generally slow`,
    `await locator.waitFor({ timeout: 1_000 });`,
    `await locator.click({ ["timeout"]: 1_000 });`,
    `await locator.click({ nested: { timeout: 1_000 } });`,
    `await locator.click({ ...options });`,
    ``,
  ].join("\n");
  await using fixture = await lintFixture(source, requireTimeoutCommentRules);

  const result = await execFileAsync("pnpm", [
    "exec",
    "oxlint",
    "--config",
    fixture.configPath,
    fixture.sourcePath,
  ]).catch((error: any) => error);

  expect(result).toMatchObject({ code: 1 });
  expect(`${result.stdout}\n${result.stderr}`.match(/middlewright\(require-timeout-comment\)/g)).toHaveLength(
    4,
  );
  expect(await readFile(fixture.sourcePath, "utf8")).toBe(source);
});

async function lintFixture(source: string, rules: Record<string, any>) {
  const directory = await mkdtemp(join(tmpdir(), "middlewright-lint-"));
  const sourcePath = join(directory, "fixture.ts");
  const configPath = join(directory, ".oxlintrc.json");
  const nodeModules = join(directory, "node_modules");
  await mkdir(nodeModules);
  await symlink(
    process.cwd(),
    join(nodeModules, "middlewright"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await writeFile(sourcePath, source);
  await writeFile(
    configPath,
    JSON.stringify({
      jsPlugins: ["middlewright/lint-plugin"],
      rules,
    }),
  );

  return {
    configPath,
    sourcePath,
    async [Symbol.asyncDispose]() {
      await rm(directory, { force: true, recursive: true });
    },
  };
}
