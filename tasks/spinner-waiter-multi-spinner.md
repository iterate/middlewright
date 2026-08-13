---
status: ready
size: small
---

# Regression test: multiple visible spinners must not trip strict mode

**Status summary:** spec'd, implementation next. The product fix already exists on main; this task adds the missing regression test.

## Background

An agent comment spotted in a consumer repo:

> Deviation from the suite's default middleware: the feed's live "Thinking…" state renders two spinner-matching elements at once, which trips spinner-waiter's strict-mode isVisible — use its documented per-call override to sit this spec out.

The bug was real: spinner-waiter used a bare `spinnerLocator.isVisible()`, which throws a strict-mode violation when the spinner selector union matches 2+ elements (e.g. two panels each showing a loading fallback). It was fixed in c392797 (shipped in middlewright 0.1.2) via `anySpinnerVisible` — `filter({ visible: true }).count() > 0` — as a drive-by in the videoMode autoStart PR, upstreaming a pnpm patch the iterate repo carried.

But no test covers it. Nothing stops a refactor from reintroducing the bare `isVisible()` call. The consumer comment above shows the real-world cost: specs opting out of the middleware entirely to dodge the crash.

## Checklist

- [ ] Add a spec to `spec/spinner-waiter.spec.ts`: a page whose loading state renders **two** elements matching the spinner selectors at once (mirroring the "Thinking…" feed scenario), where the action target appears only after loading finishes. Must pass with `anySpinnerVisible`, and fail with a strict-mode violation if reverted to bare `isVisible()`.
- [ ] Verify the test is genuinely red against the pre-fix code (temporarily revert `anySpinnerVisible` to `spinnerLocator.isVisible()` locally, confirm the strict-mode failure, restore).

## Non-goals

- No product code change — the fix is already on main.
- Not touching the consumer repo's spec; once they're on middlewright ≥0.1.2 the per-call opt-out is unnecessary, but that's their cleanup.
