---
status: complete
size: medium
---

# Ship an Oxlint plugin for locator assertions

## Status

Complete. The dependency-free plugin is published through `middlewright/lint-plugin`, the repository enforces it in CI, the requested red/autofix/manual commit checkpoints are preserved, all checks pass, and the current todo-app video is attached to the stacked pull request.

## Goal

Publish a zero-runtime-dependency Oxlint JavaScript plugin from `middlewright/lint-plugin` and use it in this repository to enforce the Playwright locator style documented in `writing-middlewright-tests.md`.

The initial `middlewright/prefer-locator-waits` rule should report and safely fix:

```ts
await expect(locator).toBeVisible();
await expect(locator).toContainText("Hello");
```

as:

```ts
await locator.waitFor();
await locator.filter({ hasText: "Hello" }).waitFor();
```

## Assumptions

- The plugin is executable JavaScript, not JSON, because Oxlint custom rules contain AST visitors and fixers.
- `oxlint` is a development dependency of this repository; the published plugin adds no runtime dependency to Middlewright.
- The rule is intentionally syntax-based: Playwright's matcher names identify the locator assertions without TypeScript type information.
- Autofixes are limited to shapes that preserve behavior: argument-free `toBeVisible()` and string, template, or regular-expression `toContainText(expected)` calls.
- Consumer configuration uses `jsPlugins: ["middlewright/lint-plugin"]` and enables `middlewright/prefer-locator-waits`.

## Commit plan

- [x] Add Oxlint, the exported plugin, public usage docs, and integration specs. *The dependency-free JS plugin is exported from `middlewright/lint-plugin`; five consumer-style Oxlint specs, typecheck, build, publint, and pack validation pass.*
- [x] Apply the plugin to this repository and push the intentionally failing lint configuration. *Oxlint runs in CI with warnings denied; the checkpoint exposes an unused import and an unassigned variable warning.*
- [x] Run `oxlint --fix` and commit only its automatic fixes. *The safe pass changed nothing; `--fix-suggestions` removed the unused `join` import in isolated commit `8363ba4`.*
- [x] Fix any remaining or malformed cases manually in a final implementation commit. *Directly evaluating the generated recovery function removes the dynamic-assignment false positive without changing the covered recovery behavior.*
- [x] Run typecheck, build, lint, tests, package validation, and attach the current todo-app video to the pull request. *Lint, typecheck, build, publint, 108 tests, and GitHub Actions pass; three provider-gated tests skip, and the fresh WebM renders inline in PR #23.*
- [x] Move this task to `tasks/complete/` when the stacked pull request is ready. *Completed on 2026-08-04 with the dated filename.*

## Implementation log

- 2026-08-04: PR #21 was merged with `origin/main` in commit `f90e921`; the resolved FFmpeg and todo-app specs pass 35/35 with typecheck green.
- 2026-08-04: Built `middlewright/prefer-locator-waits` through four red/green slices: both requested fixes, no unsafe unawaited rewrite, and reporting without fixing unsupported matcher options.
- 2026-08-04: PR #21 already contains zero locator assertions matched by the new rule. Enabling Oxlint's normal correctness baseline keeps the requested adoption checkpoint meaningful and exposes two existing warnings.
- 2026-08-04: GitHub Actions recorded the intentionally red `feae131` checkpoint with both warnings. Oxlint fixed the unused import automatically; the LLM recovery warning required the separate direct-eval cleanup.
- 2026-08-04: Added a fifth integration case so array-based `toContainText` calls are reported without an invalid `hasText` rewrite. GitHub Actions passed on `6966816`.
- 2026-08-04: Attached the current todo-app render to PR #23: https://github.com/user-attachments/assets/b27f03d5-c72a-4aec-9107-757eadc51e61
