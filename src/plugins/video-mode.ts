/**
 * video-mode: slow down and highlight actions so recorded videos are watchable.
 *
 * Extracted from the iterate monorepo's internal Playwright test
 * infrastructure (github.com/iterate/iterate, private). Modification from the
 * original: the hardcoded skip for iterate's test-helpers file is now the
 * `skipStackFrames` option.
 */
import { execFile as execFileCallback } from "node:child_process";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Locator } from "@playwright/test";
import type { ActionTiming, Plugin, OverrideableMethod } from "../plugin-system.ts";

const execFile = promisify(execFileCallback);

export type VideoModeSpan = {
  start: number;
  end: number;
};

export type VideoModeOutputs = {
  raw?: string;
  deadAirRemoved?: string;
};

export type VideoModeMetadata = {
  schemaVersion: 1;
  timebase: "ms";
  deadAir: VideoModeSpan[];
  outputs: VideoModeOutputs;
};

export type VideoModeControls = {
  /**
   * Run invisible video bookkeeping without video-mode highlighting/pauses,
   * and write the elapsed span to video-mode metadata.
   */
  deadAir<T>(action: () => Promise<T>): Promise<T>;
  /** Milliseconds since video-mode started recording metadata for this test. */
  getVideoTimestamp(): number;
  /** Current metadata snapshot. Written to video-mode.json after the test. */
  metadata(): VideoModeMetadata;
};

export type VideoModePageExtension = {
  videoMode: VideoModeControls;
};

export type VideoModePlugin = Plugin<VideoModePageExtension> & VideoModeControls;

export type VideoModeOptions = {
  /** Pause duration before action (ms). Default: 1000 */
  pauseBefore?: number;
  /** Pause duration after test (ms). Default: 3000 */
  pauseAfterTest?: number;
  /** Highlight style. Default: '3px solid gold' */
  highlightStyle?: string;
  /** Methods to skip highlighting. Default: ['waitFor'] */
  skipMethods?: OverrideableMethod[];
  /**
   * Skip highlighting for actions triggered from these files (matched as
   * substrings of stack frames). Useful for internal helpers like login
   * flows that shouldn't be slowed down. Default: []
   */
  skipStackFrames?: string[];
  /**
   * Minimum amount of each dead-air span to keep in video-tight.webm, split
   * evenly before and after the removed middle.
   */
  deadAirThreshold?: number;
};

type VideoModeState = {
  deadAirDepth: number;
  deadAirSpans: VideoModeSpan[];
  outputs: VideoModeOutputs;
  startedAt?: number;
};

type TightVideoSegment = {
  start: number;
  end: number;
};

const resolveDeadAirThreshold = (thresholdMs: number | undefined) => {
  if (thresholdMs === undefined) {
    return undefined;
  }

  if (!Number.isFinite(thresholdMs) || thresholdMs < 0) {
    throw new Error("videoMode deadAirThreshold must be a non-negative number");
  }

  return thresholdMs;
};

/** Highlight element, pause, return disposable that unhighlights */
const setupHighlight = async (locator: Locator, style: string, pauseMs: number) => {
  if (!(await locatorIsAttached(locator))) {
    return {
      [Symbol.dispose]: () => {},
    };
  }

  try {
    await locator.evaluate((el, s) => {
      const prev = el.getAttribute("style") || "";
      el.setAttribute("data-video-prev-style", prev);
      el.setAttribute(
        "style",
        `${prev}; outline: ${s} !important; outline-offset: 2px !important;`,
      );
    }, style);
  } catch {
    // Element may not be ready yet, ignore
  }
  await new Promise((resolve) => setTimeout(resolve, pauseMs));

  return {
    [Symbol.dispose]: () => {
      // Fire-and-forget cleanup - don't wait for it
      locator
        .evaluate((el) => {
          const prev = el.getAttribute("data-video-prev-style");
          if (typeof prev === "string") {
            el.setAttribute("style", prev);
            el.removeAttribute("data-video-prev-style");
          }
        })
        .catch(() => {
          // Element may be gone or not actionable, ignore
        });
    },
  };
};

const metadataFor = (state: VideoModeState): VideoModeMetadata => {
  return {
    deadAir: mergeVideoSpans(state.deadAirSpans),
    outputs: state.outputs,
    schemaVersion: 1,
    timebase: "ms",
  };
};

const recordDeadAirSpan = (state: VideoModeState, span: VideoModeSpan) => {
  const start = Math.round(span.start);
  const end = Math.round(span.end);

  if (end > start) {
    state.deadAirSpans.push({ end, start });
  }
};

const recordDeadAir = async <T>(
  state: VideoModeState,
  action: () => Promise<T>,
) => {
  if (!state.startedAt || state.deadAirDepth > 0) {
    return await action();
  }

  const start = performance.now() - state.startedAt;
  state.deadAirDepth += 1;

  try {
    return await action();
  } finally {
    state.deadAirDepth -= 1;
    const end = performance.now() - state.startedAt;
    recordDeadAirSpan(state, {
      end: Math.round(end),
      start: Math.round(start),
    });
  }
};

const mergeVideoSpans = (spans: VideoModeSpan[]) => {
  const sorted = spans
    .map((span) => ({
      end: Math.round(span.end),
      start: Math.round(span.start),
    }))
    .filter((span) => span.end > span.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const merged: VideoModeSpan[] = [];

  for (const span of sorted) {
    const previous = merged[merged.length - 1];

    if (previous && span.start <= previous.end) {
      previous.end = Math.max(previous.end, span.end);
      continue;
    }

    merged.push(span);
  }

  return merged;
};

const formatSeconds = (ms: number) => {
  const value = (ms / 1000).toFixed(3).replace(/\.?0+$/, "");
  return value || "0";
};

const clipVideoSpan = (span: VideoModeSpan, finalEnd: number): VideoModeSpan | undefined => {
  const start = Math.max(0, Math.min(Math.round(span.start), finalEnd));
  const end = Math.max(0, Math.min(Math.round(span.end), finalEnd));

  if (end <= start) {
    return undefined;
  }

  return { end, start };
};

const trimDeadAirSpan = (
  span: VideoModeSpan,
  thresholdMs: number,
): VideoModeSpan | undefined => {
  const padding = thresholdMs / 2;
  const start = Math.round(span.start + padding);
  const end = Math.round(span.end - padding);

  if (end <= start) {
    return undefined;
  }

  return { end, start };
};

const videoSpansOverlap = (left: VideoModeSpan, right: VideoModeSpan) => {
  return left.start < right.end && right.start < left.end;
};

const locatorIsAttached = async (locator: Locator) => {
  try {
    return (await locator.count()) > 0;
  } catch {
    return false;
  }
};

const waitForTargetsAttached = (args: unknown[]) => {
  const targetState = (args[0] as { state?: string } | undefined)?.state;
  return !targetState || targetState === "attached";
};

const visibleTailAfterTestMs = (pauseAfterTest: number) => Math.min(500, pauseAfterTest);

const recordAttachedWaitFromTiming = async (
  state: VideoModeState,
  timing: { actionStartedAt: number; attachedAt?: number; attachedAtStart: boolean },
  locator: Locator,
) => {
  if (!state.startedAt || timing.attachedAtStart) {
    return;
  }

  if (timing.attachedAt === undefined && (await locatorIsAttached(locator))) {
    timing.attachedAt = performance.now();
  }

  if (timing.attachedAt === undefined) {
    return;
  }

  const start = Math.round(timing.actionStartedAt - state.startedAt);
  const end = Math.round(timing.attachedAt - state.startedAt);

  recordDeadAirSpan(state, { end, start });
};

const recordMiddlewareWaitBeforeVideoMode = (
  state: VideoModeState,
  timing: ActionTiming,
) => {
  if (!state.startedAt) {
    return;
  }

  const currentMiddleware = [...timing.middlewares]
    .reverse()
    .find((middleware) => middleware.name === "video-mode" && middleware.endedAt === undefined);

  if (!currentMiddleware) {
    return;
  }

  const start = Math.round(timing.actionStartedAt - state.startedAt);
  const end = Math.round(currentMiddleware.startedAt - state.startedAt);

  recordDeadAirSpan(state, { end, start });
};

const tightVideoSegments = (options: {
  deadAir: VideoModeSpan[];
  finalEnd: number;
  thresholdMs: number;
}): TightVideoSegment[] => {
  const finalEnd = Math.max(0, Math.round(options.finalEnd));

  if (finalEnd === 0) {
    return [];
  }

  const deadAir = mergeVideoSpans(
    options.deadAir
      .map((span) => clipVideoSpan(span, finalEnd))
      .filter((span): span is VideoModeSpan => Boolean(span))
      .map((span) => trimDeadAirSpan(span, options.thresholdMs))
      .filter((span): span is VideoModeSpan => Boolean(span)),
  );
  const boundaries = new Set([0, finalEnd]);

  for (const span of deadAir) {
    boundaries.add(span.start);
    boundaries.add(span.end);
  }

  const sortedBoundaries = [...boundaries].sort((left, right) => left - right);
  const segments: TightVideoSegment[] = [];

  for (let index = 0; index < sortedBoundaries.length - 1; index += 1) {
    const start = sortedBoundaries[index];
    const end = sortedBoundaries[index + 1];

    if (end <= start) {
      continue;
    }

    if (deadAir.some((span) => videoSpansOverlap(span, { end, start }))) {
      continue;
    }

    const previous = segments[segments.length - 1];

    if (previous && previous.end === start) {
      previous.end = end;
      continue;
    }

    segments.push({ end, start });
  }

  return segments;
};

const tightVideoFilter = (options: {
  deadAir: VideoModeSpan[];
  finalEnd: number;
  thresholdMs: number;
}) => {
  const segments = tightVideoSegments(options);

  if (
    segments.length === 0 ||
    (segments.length === 1 &&
      segments[0].start === 0 &&
      segments[0].end === Math.round(options.finalEnd))
  ) {
    return undefined;
  }

  const filters: string[] = [];
  const labels: string[] = [];

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const label = `tight${index}`;
    labels.push(`[${label}]`);
    filters.push(
      `[0:v]trim=start=${formatSeconds(segment.start)}:end=${formatSeconds(segment.end)},setpts=PTS-STARTPTS[${label}]`,
    );
  }

  const outputLabel = labels.length === 1 ? labels[0].slice(1, -1) : "tightout";

  if (labels.length > 1) {
    filters.push(`${labels.join("")}concat=n=${labels.length}:v=1:a=0[${outputLabel}]`);
  }

  return {
    outputLabel,
    value: filters.join(";"),
  };
};

const videoDurationMs = async (path: string) => {
  const { stdout } = await execFile(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nokey=1:noprint_wrappers=1", path],
    { maxBuffer: 1024 * 1024 },
  );
  const seconds = Number(stdout.trim());

  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`Could not read video duration from ffprobe output: ${stdout}`);
  }

  return Math.round(seconds * 1000);
};

const waitForNonEmptyFile = async (path: string, timeoutMs = 5000) => {
  const start = Date.now();
  let lastError: unknown;

  while (Date.now() - start < timeoutMs) {
    try {
      const stats = await stat(path);
      if (stats.size > 0) {
        return;
      }
      lastError = new Error(`File exists but is empty: ${path}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Timed out waiting for non-empty file: ${path}`);
};

const removeDeadAirFromVideo = async (options: {
  inputPath: string;
  outputPath: string;
  deadAir: VideoModeSpan[];
  thresholdMs: number;
}) => {
  const finalEnd = await videoDurationMs(options.inputPath);
  const filter = tightVideoFilter({
    deadAir: options.deadAir,
    finalEnd,
    thresholdMs: options.thresholdMs,
  });

  if (!filter) {
    return false;
  }

  await execFile(
    "ffmpeg",
    [
      "-y",
      "-i",
      options.inputPath,
      "-filter_complex",
      filter.value,
      "-map",
      `[${filter.outputLabel}]`,
      "-an",
      options.outputPath,
    ],
    { maxBuffer: 10 * 1024 * 1024 },
  );

  return true;
};

/**
 * Highlights elements before actions and pauses for video recording.
 * Also pauses after tests complete for better video endings.
 */
export const videoMode = (options: VideoModeOptions = {}): VideoModePlugin => {
  const pauseBefore = options.pauseBefore || 1000;
  const pauseAfterTest = options.pauseAfterTest || 3000;
  const highlightStyle = options.highlightStyle || "3px solid gold";
  const skipMethods = options.skipMethods || ["waitFor"];
  const skipStackFrames = options.skipStackFrames || [];
  const deadAirThreshold = resolveDeadAirThreshold(options.deadAirThreshold);
  const state: VideoModeState = {
    deadAirDepth: 0,
    deadAirSpans: [],
    outputs: {},
    startedAt: performance.now(),
  };
  const controls: VideoModeControls = {
    deadAir: async (action) => {
      return await recordDeadAir(state, action);
    },
    getVideoTimestamp: () => {
      const now = performance.now();
      return Math.round(now - (state.startedAt ?? now));
    },
    metadata: () => metadataFor(state),
  };

  return {
    ...controls,
    name: "video-mode",
    pageExtension: () => ({ videoMode: controls }),

    middleware: async ({ args, locator, method, timing }, next) => {
      if (state.deadAirDepth > 0) return next();

      // Skip if called from internal helpers (navigation, login flows etc)
      if (skipStackFrames.length > 0) {
        const stack = new Error().stack || "";
        if (skipStackFrames.some((frame) => stack.includes(frame))) return next();
      }

      if (method === "waitFor") {
        if (!waitForTargetsAttached(args)) {
          return next();
        }
        recordMiddlewareWaitBeforeVideoMode(state, timing);
        try {
          return await next();
        } finally {
          await recordAttachedWaitFromTiming(state, timing, locator);
        }
      }

      recordMiddlewareWaitBeforeVideoMode(state, timing);

      if (skipMethods.includes(method)) {
        try {
          return await next();
        } finally {
          await recordAttachedWaitFromTiming(state, timing, locator);
        }
      }

      try {
        using _ = await setupHighlight(locator, highlightStyle, pauseBefore);
        return await next();
      } finally {
        await recordAttachedWaitFromTiming(state, timing, locator);
      }
    },

    testLifecycle: (emitter) => {
      const offBeforeTest = emitter.on("beforeTest", () => {
        state.deadAirDepth = 0;
        state.deadAirSpans = [];
        state.outputs = {};
        if (state.startedAt) {
          recordDeadAirSpan(state, {
            end: Math.round(performance.now() - state.startedAt),
            start: 0,
          });
        } else {
          state.startedAt = performance.now();
        }
      });

      const offAfterTest = emitter.on("afterTest", async ({ page, testInfo }) => {
        const visibleTailMs = visibleTailAfterTestMs(pauseAfterTest);
        if (visibleTailMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, visibleTailMs));
        }

        const remainingAfterTestMs = pauseAfterTest - visibleTailMs;
        if (remainingAfterTestMs > 0) {
          await recordDeadAir(state, async () => {
            await new Promise((resolve) => setTimeout(resolve, remainingAfterTestMs));
          });
        }

        const deadAir = metadataFor(state).deadAir;
        const video = page.video();

        if (video) {
          const rawPath = join(testInfo.outputDir, "video-raw.webm");
          const tightPath = join(testInfo.outputDir, "video-tight.webm");
          await mkdir(testInfo.outputDir, { recursive: true });

          if (!page.isClosed()) {
            await page.close({ runBeforeUnload: false });
          }

          const recordedVideoPath = await video.path();
          await waitForNonEmptyFile(recordedVideoPath);
          await copyFile(recordedVideoPath, rawPath);
          state.outputs.raw = "video-raw.webm";
          await testInfo.attach("video-raw", {
            contentType: "video/webm",
            path: rawPath,
          });

          if (deadAir.length > 0 && deadAirThreshold !== undefined) {
            const wroteTightVideo = await removeDeadAirFromVideo({
              deadAir,
              inputPath: rawPath,
              outputPath: tightPath,
              thresholdMs: deadAirThreshold,
            });

            if (wroteTightVideo) {
              state.outputs.deadAirRemoved = "video-tight.webm";
              await testInfo.attach("video-tight", {
                contentType: "video/webm",
                path: tightPath,
              });
            }
          }
        }

        const metadata = metadataFor(state);
        if (metadata.deadAir.length > 0) {
          const path = join(testInfo.outputDir, "video-mode.json");
          await mkdir(testInfo.outputDir, { recursive: true });
          await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`);
          await testInfo.attach("video-mode", {
            contentType: "application/json",
            path,
          });
        }

        state.startedAt = undefined;
        console.log(`video-mode metadata written to ${testInfo.outputDir}/video-mode.json`);
      });

      return () => {
        offBeforeTest();
        offAfterTest();
      };
    },
  };
};
