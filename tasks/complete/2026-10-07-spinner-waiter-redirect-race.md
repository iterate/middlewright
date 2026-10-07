---
status: done
size: small
branch: spinner-redirect-race
---

# spinner-waiter: a document that commits mid-check gets its own quick check

**Status summary**: done. One real-server spec that fails on main 20/20 with the 1ms fast-fail and passes with the fix, one spec for a page that never stops navigating; README updated; Codex review taken.

## Why

`../iterate`'s `integrations.spec.ts` ("a project connects X…") failed in CI
mid-redirect: a click set off consent → callback → app page, and the next
action fast-failed with `Timeout 1ms exceeded` while the app was still
loading. Its trace showed `readyState` "complete" and, 1.6s later, a spinner
count of 0 on the page the redirect returned.

## What is really going on

Chromium suspends renderer-bound DevTools commands from `DidStartNavigation`
to `DidFinishNavigation` (`render_frame_devtools_agent_host.cc`). So
`page.evaluate`, `isVisible()` and `count()` issued during a navigation stall
until it finishes; a query bound to the old document then fails with a
destroyed context, which Playwright reports as `false` / `0`, and a fresh
query sees the new document. The 250ms race in `pageIsNavigating` reads a
stalled evaluate as loading, but nothing in the "is loading" decision noticed
when the main frame *navigated under it*:

- the quick check spends its second on the page the click left, then the
  loading check runs on a freshly committed page that has not drawn its
  spinner yet; or
- `readyState` comes from the old document and the spinner count reports 0
  after the navigation, when the navigation starts between the two.

Either way the fast-fail hits a document that never had its second.

## Decision

Count main-frame `framenavigated` events per page (new documents and
same-document navigations alike; failed navigations do not fire it, Chromium's
error-page commit does). If the count changed during the quick check or the
loading check, run the quick check again on the page that is there now. All of
it is charged against one deadline, `spinnerTimeout` minus the action's last
second, which the spinner wait also respects; a page still navigating at the
deadline counts as loading and fails with the "navigation was still in flight"
message. The common fast-fail path (no navigation) only adds two WeakMap reads.

Considered and not taken:

- Tracking pending main-frame navigation requests: network events do stay
  observable while renderer commands stall, but it does nothing for the
  post-commit, pre-spinner window the failing spec reproduces.
- Reading `readyState` after the spinner count: probes can still span two
  documents, and it does nothing for the spent quick check.
- A stable "not loading" window before every fast-fail: a one-second window
  would cover a spinner drawn late in the new document's first second, at the
  cost of a second on every ordinary failure.

Known limits, unchanged: the probes themselves carry no deadline (a navigation
that never finishes holds them past `spinnerTimeout`); the straddled-decision
variant has no deterministic spec, since it needs a navigation to start in
the few milliseconds between two probes; `waitForReadyWhileSpinning`'s grace
period starts once and does not restart on a later navigation.

## Checklist

- [x] spec: a Connect button that fetches, then follows a redirect chain to a page that draws its spinner 850ms after commit _(fails 20/20 on main with `Timeout 1ms exceeded`, passes 20/20 after)_
- [x] spec: a page that reloads itself every 300ms fails within the budget with the navigation message
- [x] `mainFrameNavigations(page)` + re-run of the quick check after a navigation, one deadline for the whole wait
- [x] README: the new document gets the quick check again, within the same budget
- [x] existing "fails fast once a navigation has fully loaded" spec still passes, 4.2s instead of 3.2s
- [x] Codex review (gpt-6-astra, max): budget accounting, navigation-aware exhaustion message, counter naming, comment claims, server shutdown order, repeated-navigation spec — all taken; a deterministic straddle spec was asked for and is recorded above as not constructible
