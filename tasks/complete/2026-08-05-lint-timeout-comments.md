---
status: complete
size: medium
---

# Require explanations for explicit timeouts

## Status

Complete, including review follow-up. Explanation patterns are configurable, the defaults require both the timeout and spinner waiter to be addressed, and lint errors link to guidance that makes loading UI the preferred fix. The repository's exceptions now state why spinner waiting cannot apply.

## Goal

Add `middlewright/require-timeout-comment`, an Oxlint rule that reports explicit timeout options unless a nearby `//` comment matches every required explanation pattern.

```ts
await page.getByRole("button").click({ timeout: 10_000 }); // reported

// timeout is needed because the export exposes no loading state for spinner waiter
await page.getByRole("button").click({ timeout: 10_000 }); // allowed
```

## Assumptions

- The syntax-only rule checks direct `timeout` properties in object arguments to member calls. This covers `waitFor`, `click`, `fill`, and other timeout-bearing APIs without maintaining a method-name list.
- Direct identifier, string-literal, and shorthand `timeout` properties count; computed and spread properties do not because their keys cannot be known statically.
- Only `//` comments count. Required patterns are case-insensitive regex sources; they default to `timeout` and `spinner.?waiter`.
- For one-line calls, the comment may trail the call or appear on the previous physical line. For multiline calls, a comment may instead sit on the timeout property's line or the line immediately above it.
- The rule reports but does not autofix because it cannot invent a useful explanation.

## Checklist

- [x] Add a failing consumer-style spec for an unexplained timeout and make the new rule report it. *`middlewright/require-timeout-comment` now reports direct timeout properties in object arguments to member calls.*
- [x] Add passing specs for same-line and preceding-line timeout comments, including multiline options. *Whole-word, case-insensitive `//` comments are accepted beside the call or timeout property.*
- [x] Cover method and property shapes without broadening into nested object values or block comments. *Identifier, quoted, and shorthand properties report; computed, spread, nested, block-comment, and plural-word shapes are covered explicitly.*
- [x] Enable the rule in this repository and document consumer configuration. *The repo config enables the rule; eight existing overrides now explain their local timeout budgets, and README usage covers both exported rules.*
- [x] Run lint, typecheck, build, package validation, the full test suite, and the todo-app visual baseline. *Lint, typecheck, build, publint, pack, all 12 plugin specs, and the todo baseline pass. The full local run passed 114 specs and skipped 3; the existing macOS FFmpeg pointer-tail visual check failed after retries.*
- [x] Attach the current todo-app render to the draft pull request and monitor CI/review comments. *PR #25 renders the user-attachment WebM inline; the foreground PR monitor is checking the final head.*
- [x] Make required explanation patterns configurable and strengthen the defaults. *`requiredPatterns` accepts case-insensitive regex sources; the defaults are `timeout` and `spinner.?waiter`, and every pattern must match the nearby line comment.*
- [x] Point lint failures to clear timeout guidance. *The rule recommends loading UI plus `spinnerWaiter` before an override and links to the new focused README section.*
- [x] Accept explanations beside terminal methods in multiline chains. *The location check now includes the member method line, with a consumer regression covering a comment directly above `.click({`.*

## Implementation log

- 2026-08-05: Based the worktree on `origin/main` after PR #23 merged as `453d540`.
- 2026-08-05: Completed the first red/green slice through the published `middlewright/lint-plugin` path.
- 2026-08-05: Added nearby-comment exemptions as two vertical slices: one-line calls first, then multiline timeout properties.
- 2026-08-05: Enabling the rule exposed eight repository violations; each now has a local reason instead of a generic suppression.
- 2026-08-05: Verified the packed export, attached the todo-app render to PR #25, and confirmed GitHub produced an inline video player.
- 2026-08-06: Handled review feedback with two more red/green slices for stronger defaults and configurable patterns, then added the linked product-guidance docs.
- 2026-08-10: Reproduced Bugbot's chained-call finding and fixed it by anchoring nearby comments to the terminal member method as well as the chain head and timeout property.
