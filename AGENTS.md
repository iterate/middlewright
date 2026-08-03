# middlewright Agent Notes

## Plugin Boundaries

When plugins interact, preserve caller ergonomics and plugin ownership. Expose shared cross-cutting facts through neutral middleware context rather than coupling one plugin to another plugin's feature.

For example, `spinnerWaiter` should own spinner-specific waiting and errors, while `videoMode` should own video highlighting, dead-air metadata, and ffmpeg output. If both need timing information, add or use neutral middleware context such as `ActionContext.timing`; do not make `spinnerWaiter` know about `videoMode.deadAir`.

### Writing tests

Guidance for *end-users* to write tests is in [./writing-middlewright-tests.md](./writing-middlewright-tests.md). In many cases we should follow this guidance too, but we may additionally want to validate the assumptions we ask end-users to make, so deviate from that guidance consciously, but not arbitrarily or unthinkingly.

### Pull request video

Before handing off any pull request, run `spec/todo-app.spec.ts` and attach its current rendered video to the pull request body using a GitHub user-attachment URL so it plays inline. This is the shared visual baseline for spotting pacing and rendering regressions. When the pull request changes recording or rendering behavior, attach the raw Playwright recording too and label both videos clearly.
