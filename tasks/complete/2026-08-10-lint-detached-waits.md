---
status: complete
size: medium
issue: https://github.com/iterate/middlewright/issues/27
---

# Prefer positive waits over detached waits

## Status

Complete. The exported rule reports static detached waits, supports configurable nearby exception comments, and is enabled and documented in this repo. Local and GitHub verification pass, and the draft PR includes the rendered todo-app baseline.

## Goal

Add an exported Oxlint rule that reports `.waitFor({ state: "detached" })` by default. Tests should wait for positive UI such as results, empty states, or error states instead of treating an element's absence as proof that the intended outcome occurred.

```ts
await page.getByText("Florence").waitFor({ state: "detached" }); // reported

await page.getByText("No results found").waitFor(); // preferred
```

## Assumptions

- Export the rule as `middlewright/prefer-positive-waits` from the existing zero-dependency `middlewright/lint-plugin` entry point.
- Report direct, non-computed `.waitFor(...)` calls whose direct object argument has a static `state: "detached"` property. Dynamic state expressions and other methods remain outside the syntax-only rule.
- Allow an exceptional detached wait when a nearby `//` comment matches every configured case-insensitive regex source. The default required pattern is `detached`, making the exception explicit without pretending the rule can judge the explanation's quality.
- Reuse the timeout rule's comment placement semantics: same line or a standalone preceding line beside the call, terminal method, or state property.
- Do not autofix. The rule cannot infer the positive product state that should replace absence.
- Add focused docs explaining why absence is ambiguous and showing positive result, empty-state, and error-state waits.

## Checklist

- [x] Add a failing consumer-style spec for an unexplained detached wait and make the exported rule report it. *`middlewright/prefer-positive-waits` reports a direct `.waitFor({ state: "detached" })` and links to the planned positive-wait guidance.*
- [x] Add a passing spec for nearby exception comments and configurable required patterns. *A nearby line comment must match `detached` by default; projects can replace that with case-insensitive `requiredPatterns`.*
- [x] Cover static and dynamic call/property boundaries without broadening into unrelated waits. *Direct identifier and quoted state keys report; computed calls/keys, dynamic states, other methods, nested values, and `waitFor_original` remain outside the rule.*
- [x] Enable the rule in this repository and document positive-wait guidance and consumer config. *The repo config enables the rule; README and the test-writing guide explain why explicit result, empty, or error UI is safer than absence.*
- [x] Run lint, typecheck, build, package validation, the lint plugin specs, full CI, and the todo-app visual baseline. *Lint, typecheck, build, publint, pack, all 18 lint-plugin specs, the 130-pass full suite, and GitHub CI pass.*
- [x] Attach the todo-app render to the draft pull request and monitor CI/review comments. *PR #28 renders the current todo-app WebM inline; the monitor found no unresolved threads or review comments on the implementation head.*

## Implementation log

- 2026-08-10: Created from current `origin/main` after PR #25 merged as `5dd4fae`.
- 2026-08-10: Completed the first red/green slice through the published `middlewright/lint-plugin` path.
- 2026-08-10: Added nearby default and configurable exception patterns as two consumer-level slices, then reused the hardened comment-placement logic from the timeout rule.
- 2026-08-10: Verified the full suite, attached the rendered todo-app baseline to PR #28, and confirmed implementation CI and the package preview are green.
