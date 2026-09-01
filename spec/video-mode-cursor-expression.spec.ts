import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { test, expect } from "@playwright/test";
import { cursorExpression } from "../src/plugins/video-mode.ts";

const execFile = promisify(execFileCallback);

// Far more waypoint segments than ffmpeg 8's expression parser allows in
// nesting depth (~100 levels — the old one-nested-if-per-segment form died
// there with "Missing ')' or too many args"). A long pointer-mode test
// reaches 100+ segments easily: the cursor plan emits ~3 waypoints per
// highlighted action.
const SEGMENT_COUNT = 400;

const waypoints = Array.from({ length: SEGMENT_COUNT + 1 }, (_, index) => ({
  // Integer milliseconds, like pushCursorWaypoint produces. Uneven spacing so
  // segment boundaries don't all land on round numbers.
  at: index * 137,
  x: index % 2 === 0 ? 24 : 613,
  y: 10 + (index % 7) * 41,
}));

test("cursor expression depth stays constant no matter how many waypoints", () => {
  for (const property of ["x", "y"] as const) {
    const expression = cursorExpression(waypoints, property);
    let depth = 0;
    let maxDepth = 0;
    for (const char of expression) {
      if (char === "(") maxDepth = Math.max(maxDepth, (depth += 1));
      if (char === ")") depth -= 1;
    }
    expect(depth).toBe(0);
    // Comfortably inside ffmpeg 8's ~100-level cap, with headroom for the
    // filter around it.
    expect(maxDepth).toBeLessThan(32);
  }
});

test("ffmpeg parses and evaluates the cursor expression at full length", async () => {
  // The expression embedded exactly as cursorOverlayFilters embeds it:
  // single-quoted inside an overlay's x/y with `\,` comma escapes intact.
  // On ffmpeg 8 the old nested form fails this probe at this segment count.
  const filter = [
    `[0:v][1:v]overlay=x='${cursorExpression(waypoints, "x")}'`,
    `y='${cursorExpression(waypoints, "y")}'`,
    "eval=frame",
    "eof_action=pass[out]",
  ].join(":");
  // prettier-ignore
  await execFile("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=black:s=320x240:d=0.2",
    "-f", "lavfi", "-i", "color=c=red:s=8x8:d=0.2",
    "-filter_complex", filter, "-map", "[out]", "-f", "null", "-",
  ]);
});

test("cursor expression values match the waypoint interpolation, boundaries included", () => {
  for (const property of ["x", "y"] as const) {
    const evaluate = evaluableExpression(cursorExpression(waypoints, property));
    const sampleTimesMs = [
      // Outside the plan on both sides: the pointer parks at its final stop.
      -50,
      waypoints[waypoints.length - 1].at,
      waypoints[waypoints.length - 1].at + 5000,
      // Every segment boundary — where the old inclusive-both-ends `between`
      // windows overlapped, and a naive flattened sum would double the
      // coordinate — plus each segment's interior.
      ...waypoints.map((waypoint) => waypoint.at),
      ...waypoints.slice(0, -1).map((waypoint, index) => {
        return (waypoint.at + waypoints[index + 1].at) / 2;
      }),
    ];
    for (const timeMs of sampleTimesMs) {
      expect(evaluate(timeMs / 1000)).toBeCloseTo(interpolatedPosition(property, timeMs), 3);
    }
  }
});

/** What the pointer overlay should show at `timeMs`: smoothstep-eased travel
 * within a segment, the final waypoint's position outside the plan. */
function interpolatedPosition(property: "x" | "y", timeMs: number) {
  for (let index = 0; index < waypoints.length - 1; index += 1) {
    const from = waypoints[index];
    const to = waypoints[index + 1];
    if (timeMs >= from.at && timeMs < to.at) {
      const progress = (timeMs - from.at) / (to.at - from.at);
      const eased = progress * progress * (3 - 2 * progress);
      return from[property] + (to[property] - from[property]) * eased;
    }
  }
  return waypoints[waypoints.length - 1][property];
}

/** Turn the ffmpeg arithmetic (t, + - * /, gte, lt, `\,` escapes) into a
 * callable so the spec can compare positions numerically. */
function evaluableExpression(expression: string): (t: number) => number {
  const source = expression.replace(/\\,/g, ",");
  expect(source).toMatch(/^[\d\s+\-*/().,teglf]+$/); // only arithmetic, t, gte/lt
  const gte = (a: number, b: number) => (a >= b ? 1 : 0);
  const lt = (a: number, b: number) => (a < b ? 1 : 0);
  // eslint-disable-next-line no-new-func -- evaluating our own generated arithmetic
  const compiled = new Function("t", "gte", "lt", `return ${source};`);
  return (t) => compiled(t, gte, lt);
}
