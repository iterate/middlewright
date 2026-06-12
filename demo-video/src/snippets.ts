import type { CodeLine } from "./components/CodeWindow";

/** The spec under test — completely ordinary Playwright code */
export const specLines = (opts: {
  importFrom: "@playwright/test" | "./test-helpers";
  /** show the old import struck out above the new one */
  importDiff?: boolean;
  /** the sad path: .click() gets a per-action timeout bump, as a diff at this local frame */
  timeoutDiffAt?: number;
}): CodeLine[] => [
  ...(opts.importDiff
    ? ([
        { text: `import { test } from "@playwright/test";`, kind: "del" },
        { text: `import { test } from "./test-helpers";`, kind: "add" },
      ] satisfies CodeLine[])
    : [{ text: `import { test } from "${opts.importFrom}";` }]),
  { text: "" },
  { text: `test("generate a report", async ({ page }) => {` },
  { text: `  await page.goto("/reports");` },
  { text: `  await page.getByRole("button", { name: "Generate report" }).click();` },
  ...(opts.timeoutDiffAt !== undefined
    ? ([
        { text: `  await page.getByText("Report ready").click();`, delAt: opts.timeoutDiffAt },
        {
          text: `  await page.getByText("Report ready").click({ timeout: 30_000 });`,
          kind: "add",
          appearAt: opts.timeoutDiffAt + 6,
        },
      ] satisfies CodeLine[])
    : [{ text: `  await page.getByText("Report ready").click();` }]),
  { text: `});` },
];

/** The middlewright fixture, mirroring the README quick start */
export const helperLines = (appearFrom: number, focusAt: number): CodeLine[] => {
  const lines: Array<Pick<CodeLine, "text" | "kind">> = [
    { text: `import { test as base } from "@playwright/test";` },
    { text: `import { addPlugins, spinnerWaiter } from "middlewright";` },
    { text: `` },
    { text: `export const test = base.extend({` },
    { text: `  page: async ({ page }, use, testInfo) => {` },
    { text: `    await using plugged = await addPlugins({` },
    { text: `      page, testInfo, plugins: [spinnerWaiter()],`, kind: "focus" },
    { text: `    });` },
    { text: `    await use(plugged);` },
    { text: `  },` },
    { text: `});` },
  ];
  return lines.map((line, i) => ({ ...line, appearAt: appearFrom + i * 4, focusAt }));
};

/** The product code, gaining a loading state */
export const productLines = (addAt: number): CodeLine[] => [
  { text: `<button onClick={generateReport}>` },
  { text: `  Generate report` },
  { text: `</button>` },
  { text: `` },
  { text: `{status === "generating" && (`, kind: "add", appearAt: addAt },
  { text: `  <p aria-label="Loading">Generating…</p>`, kind: "add", appearAt: addAt + 5 },
  { text: `)}`, kind: "add", appearAt: addAt + 10 },
  { text: `` },
  { text: `{status === "ready" && (` },
  { text: `  <a href={reportUrl}>Report ready</a>` },
  { text: `)}` },
];
