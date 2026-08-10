---
status: ready
size: medium
issue: https://github.com/iterate/middlewright/issues/27
---

# Prefer positive waits over detached waits

## Status

Implementation is roughly 25% complete. The exported rule now reports a direct static detached wait through the packed consumer path. Exception comments, syntax boundaries, repo config, docs, and full verification remain.

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
- [ ] Add a passing spec for nearby exception comments and configurable required patterns.
- [ ] Cover static and dynamic call/property boundaries without broadening into unrelated waits.
- [ ] Enable the rule in this repository and document positive-wait guidance and consumer config.
- [ ] Run lint, typecheck, build, package validation, the lint plugin specs, full CI, and the todo-app visual baseline.
- [ ] Attach the todo-app render to the draft pull request and monitor CI/review comments.

## Implementation log

- 2026-08-10: Created from current `origin/main` after PR #25 merged as `5dd4fae`.
- 2026-08-10: Completed the first red/green slice through the published `middlewright/lint-plugin` path.
