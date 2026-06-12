# plugwright demo video

A [Remotion](https://remotion.dev) project that renders the plugwright demo video — the story of a
slow "generate report" feature, a fast `actionTimeout`, the `.click({ timeout: 30_000 })` sad path,
and the `spinnerWaiter` happy path.

```bash
pnpm install
pnpm dev      # remotion studio, for editing
pnpm render   # writes out/plugwright-demo.mp4
```

Structure:

- `src/Root.tsx` — scene list + durations (30fps, 1920×1080, ~74s)
- `src/scenes/` — one file per scene (title → setup → fail slow → sad path → plugwright → fail fast → add spinner → happy run → outro)
- `src/components/` — the fake browser/app, code window with diff highlighting, terminal with stopwatch, cursor, and popover annotations
- layout: `report.spec.ts` stays top-left for the whole video; ancillary code (test-helpers.ts, the product component, playwright.config.ts) appears temporarily below it; the app and terminal share the right half
- `src/snippets.ts` — the code shown in the code window (mirrors the README quick start)
