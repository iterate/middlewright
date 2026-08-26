---
status: in-progress
size: small
branch: spinner-waiter-navigation
---

# spinner-waiter: an in-flight navigation counts as loading

**Status summary**: spec'd, implementing. Small change to `src/plugins/spinner-waiter.ts` plus a spec.

## Why

`../iterate`'s mobile specs still carry `{ timeout: 15_000 }` on popup actions
even though popups auto-wrap now. The comments say why: the popup is
*mid-navigation* to the auth worker ("the popup event fires before its
cross-server auth navigation mounts the login choices"; "clicks land after
auth-worker navigations that run cold on fresh preview deploys — CI-proven
>1s"). During a navigation the app cannot render a spinner — there is no
document yet — so spinner-waiter sees no loading UI and fast-fails in 1ms.
But the browser itself is visibly loading. That is loading UI by any honest
reading of the plugin's rule ("if the app is visibly loading, wait longer").

## Decision

Treat an in-flight navigation exactly like a visible spinner:

- `document.readyState === "loading"` (until DOMContentLoaded — deliberately
  not `"interactive"`, so slow subresources can't mask a broken page), or
- no execution context to ask (`page.evaluate` throws "Execution context was
  destroyed … navigation") — the gap between a navigation's commit and its new
  document.

A closed page is not loading. The same predicate feeds both the initial
"is anything loading?" check and the "loading finished without the target"
bail-out, so error hints stay accurate ("Loading finished (spinner gone /
navigation done)").

Out of scope: `page.waitForEvent("popup", { timeout })` — an event wait, not a
locator action; middlewright never sees it and the fix there is product
loading UI on the button that triggers the auth round-trips.

## Checklist

- [ ] `pageIsNavigating(page)` predicate; fold into the loading checks
- [ ] spec: a click whose target only exists after a slow cross-page navigation (no app spinner) succeeds without an explicit timeout
- [ ] spec: navigation completes but the target never appears → fast fail after the navigation, with the loading-finished hint
- [ ] README: mention navigation counts as loading under spinnerWaiter

## Implementation log

- 2026-08-18: found via `../iterate` specs (`specs/mobile/{notifications,approvals}.spec.ts`).
