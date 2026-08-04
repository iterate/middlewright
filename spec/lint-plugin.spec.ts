import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test, expect } from "@playwright/test";

const execFileAsync = promisify(execFile);

test("fixes visible locator assertions to locator waits", async () => {
  await using fixture = await lintFixture(
    `await expect(page.getByText("Ready")).toBeVisible();\n`,
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
  await using fixture = await lintFixture(source);

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
  await using fixture = await lintFixture(source);

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

async function lintFixture(source: string) {
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
      rules: { "middlewright/prefer-locator-waits": "error" },
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
