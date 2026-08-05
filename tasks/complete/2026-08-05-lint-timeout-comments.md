---
status: complete
size: medium
---

# Require explanations for explicit timeouts

## Status

Complete. The exported plugin reports unexplained direct timeout options, the repository enables the rule, existing overrides explain their timeout budgets, and the consumer docs and specs cover the supported boundaries. The draft PR includes the current todo-app visual baseline and is being monitored.

## Goal

Add `middlewright/require-timeout-comment`, an Oxlint rule that reports explicit timeout options unless a nearby `//` comment contains the word `timeout`.

```ts
await page.getByRole("button").click({ timeout: 10_000 }); // reported

// timeout is longer because the export runs asynchronously
await page.getByRole("button").click({ timeout: 10_000 }); // allowed
```

## Assumptions

- The syntax-only rule checks direct `timeout` properties in object arguments to member calls. This covers `waitFor`, `click`, `fill`, and other timeout-bearing APIs without maintaining a method-name list.
- Direct identifier, string-literal, and shorthand `timeout` properties count; computed and spread properties do not because their keys cannot be known statically.
- Only `//` comments count. `timeout` is matched as a case-insensitive whole word.
- For one-line calls, the comment may trail the call or appear on the previous physical line. For multiline calls, a comment may instead sit on the timeout property's line or the line immediately above it.
- The rule reports but does not autofix because it cannot invent a useful explanation.

## Checklist

- [x] Add a failing consumer-style spec for an unexplained timeout and make the new rule report it. *`middlewright/require-timeout-comment` now reports direct timeout properties in object arguments to member calls.*
- [x] Add passing specs for same-line and preceding-line timeout comments, including multiline options. *Whole-word, case-insensitive `//` comments are accepted beside the call or timeout property.*
- [x] Cover method and property shapes without broadening into nested object values or block comments. *Identifier, quoted, and shorthand properties report; computed, spread, nested, block-comment, and plural-word shapes are covered explicitly.*
- [x] Enable the rule in this repository and document consumer configuration. *The repo config enables the rule; eight existing overrides now explain their local timeout budgets, and README usage covers both exported rules.*
- [x] Run lint, typecheck, build, package validation, the full test suite, and the todo-app visual baseline. *Lint, typecheck, build, publint, pack, all 10 plugin specs, and the todo baseline pass. The full local run passed 114 specs and skipped 3; the existing macOS FFmpeg pointer-tail visual check failed after retries.*
- [x] Attach the current todo-app render to the draft pull request and monitor CI/review comments. *PR #25 renders the user-attachment WebM inline; the foreground PR monitor is checking the final head.*

## Implementation log

- 2026-08-05: Based the worktree on `origin/main` after PR #23 merged as `453d540`.
- 2026-08-05: Completed the first red/green slice through the published `middlewright/lint-plugin` path.
- 2026-08-05: Added nearby-comment exemptions as two vertical slices: one-line calls first, then multiline timeout properties.
- 2026-08-05: Enabling the rule exposed eight repository violations; each now has a local reason instead of a generic suppression.
- 2026-08-05: Verified the packed export, attached the todo-app render to PR #25, and confirmed GitHub produced an inline video player.
