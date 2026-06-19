# middlewright Agent Notes

## Plugin Boundaries

When plugins interact, preserve caller ergonomics and plugin ownership. Expose shared cross-cutting facts through neutral middleware context rather than coupling one plugin to another plugin's feature.

For example, `spinnerWaiter` should own spinner-specific waiting and errors, while `videoMode` should own video highlighting, dead-air metadata, and ffmpeg output. If both need timing information, add or use neutral middleware context such as `ActionContext.timing`; do not make `spinnerWaiter` know about `videoMode.deadAir`.
