---
status: in-progress
size: small
source: https://github.com/iterate/iterate/pull/2080
---

# Backport the screenshot plugin

## Status

Scoped and ready for implementation. The Iterate behavior and middlewright plugin conventions have been reviewed; the plugin, public export, docs, and integration coverage remain to be added.

## Scope

Backport Iterate's opt-in screenshot helper as a first-class middlewright plugin. Keep the fixture-friendly `screenshot()` API and `PLAYWRIGHT_SCREENSHOT` command-line switch: semicolon-separated regular expressions match `locator.toString()`, and each successful match produces a full-page PNG in the Playwright test output and an attachment in its report.

Library-specific decisions:

- Keep environment parsing inside the plugin because temporary command-line opt-in without changing a fixture is the feature's main ergonomic benefit.
- Keep `PWDEBUG` as a hard no-op, matching the other bundled plugins.
- Implement readable locator slugs locally rather than depending on Iterate's private shared package.
- Share occurrence counts by `TestInfo`, so matching actions on multiple plugged pages cannot overwrite one another.
- Capture only after successful actions; a failed action must not leave a misleading artifact.

## Checklist

- [ ] Add a public `screenshot()` plugin with environment-driven locator matching.
- [ ] Save and attach readable, non-colliding full-page PNGs after successful matching actions.
- [ ] Cover the public behavior through Playwright integration specs, including multiple pages and failed actions.
- [ ] Export and document the plugin alongside the existing bundled plugins.
- [ ] Run focused tests, the full suite, typecheck, and build.
- [ ] Open and keep a draft pull request updated with reviewer-oriented usage and verification notes.

## Implementation log

- 2026-07-23: Reviewed Iterate PR #2080 and middlewright's plugin/test conventions. Chose a direct ergonomic backport with no new dependency and one extra failure-path regression spec.
