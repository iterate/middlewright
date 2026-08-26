---
status: done
size: small
branch: spinner-waiter-navigation
---

# spinner-waiter: an in-flight navigation counts as loading

**Status summary**: done. spinner-waiter now treats a document that hasn't fired `load` (or has no execution context yet) as loading UI. Two specs; README updated. One limitation recorded below (an action that *initiates* a slow navigation).

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

- the current document hasn't fired `load` yet (`readyState !== "complete"` —
  the browser's own tab spinner is the reference; the grace period and
  spinner timeout bound it as they do an app spinner), or
- no execution context to ask — the gap while a navigation commits.

Not needed (found out by instrumenting): tracking pending main-frame requests.
Playwright's locator queries (`isVisible`, `count`) already block until a
pending navigation commits, so spinner-waiter never observes that phase; the
reachable window is *after* commit, before `load` — a cold page rendering its
UI client-side. A first cut carried a request tracker; it was dead code and is
gone.

A closed page is not loading. The same predicate feeds both the initial
"is anything loading?" check and the "loading finished without the target"
bail-out, so error hints stay accurate ("Loading finished (spinner gone /
navigation done)").

Out of scope:

- `page.waitForEvent("popup", { timeout })` — an event wait, not a locator
  action; middlewright never sees it and the fix there is product loading UI
  on the button that triggers the auth round-trips.
- An action that *initiates* a slow navigation (clicking a link to a cold
  server): Playwright's click waits for the navigation it started, inside the
  action's own timeout, after spinner-waiter has already let it through. Found
  while writing the spec (the anchor click itself hit the 1s budget). Worth its
  own task if it bites for real; the popup case doesn't trigger it because the
  popup arrives already navigating.

## Checklist

- [x] `pageIsNavigating(page)` predicate; fold into the loading checks _(`loadingVisible` = navigating || spinner, checked navigation-first; used for both the initial check and the loading-finished bail-out)_
- [x] spec: a click whose target only exists after a slow cross-page navigation (no app spinner) succeeds without an explicit timeout _("waits while a freshly navigated document is still loading" — proven load-bearing by disabling the check: fast-fails at 1ms without it)_
- [x] spec: navigation completes but the target never appears → fast fail after the navigation _(the ordinary no-spinner fast-fail once the document is complete — Playwright had already waited out the commit, so the loading branch isn't what's exercised there)_
- [x] README: mention navigation counts as loading under spinnerWaiter

## Implementation log

- 2026-08-18: found via `../iterate` specs (`specs/mobile/{notifications,approvals}.spec.ts`).
- 2026-08-18: implemented; instrumented to learn Playwright already blocks locator queries until commit, dropped the request tracker accordingly. 154 tests green.
