/**
 * video-mode: record action timings and render watchable videos after the run.
 *
 * Extracted from the iterate monorepo's internal Playwright test
 * infrastructure (github.com/iterate/iterate, private). Modification from the
 * original: the hardcoded skip for iterate's test-helpers file is now the
 * `skipStackFrames` option.
 */
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import type { Locator, TestInfo } from "@playwright/test";
import type { ActionTiming, Plugin, OverrideableMethod } from "../plugin-system.ts";

const execFile = promisify(execFileCallback);
const VIDEO_MODE_METADATA_FILE = "video-mode.json";
const VIDEO_MODE_PLAYER_FILE = "video-mode.html";
const VIDEO_MODE_RAW_FILE = "video-raw.webm";
const VIDEO_MODE_RENDERED_FILE = "video-rendered.webm";
const VIDEO_MODE_REPORT_PLAYER_FILE = "video-mode-report.html";
const VIDEO_MODE_POINTER_FILE = "video-mode-pointer.png";
const VIDEO_MODE_CLICK_POINTER_FILE = "video-mode-click-pointer.png";
// Pointer assets adapted from Pictogrammers Material Design Icons:
// cursor-default.svg and cursor-pointer.svg.
// Source: https://github.com/Templarian/MaterialDesign
// Icons are distributed under the Pictogrammers Free License / Apache 2.0.
const VIDEO_MODE_POINTER_PNG =
  "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";
const VIDEO_MODE_POINTER_SOURCE_SIZE = 64;
const VIDEO_MODE_POINTER_SIZE = 28;
const VIDEO_MODE_POINTER_HOTSPOT = { x: 18, y: 6 };
const VIDEO_MODE_CLICK_POINTER_PNG =
  "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";
const VIDEO_MODE_CLICK_POINTER_SOURCE_SIZE = 64;
const VIDEO_MODE_CLICK_POINTER_SIZE = 28;
const VIDEO_MODE_CLICK_POINTER_HOTSPOT = { x: 28, y: 7 };

export type VideoModeSpan = {
  start: number;
  end: number;
};

export type VideoModeOutputs = {
  player?: string;
  raw?: string;
  rendered?: string;
};

export type VideoModeOutputPaths = {
  metadata: string;
  player: string;
  raw: string;
  rendered: string;
  reportPlayer: string;
};

export type VideoModeSourceRange = {
  start?: number;
  end?: number;
};

export type VideoModeRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type VideoModeViewport = {
  width: number;
  height: number;
};

export type VideoModeHighlight = VideoModeSpan & {
  actionEnd?: number;
  color: string;
  image?: string;
  method?: OverrideableMethod;
  rect: VideoModeRect;
  thickness: number;
  viewport: VideoModeViewport;
};

export type VideoModeMetadata = {
  schemaVersion: 1;
  timebase: "ms";
  deadAir: VideoModeSpan[];
  highlights: VideoModeHighlight[];
  outputs: VideoModeOutputs;
  sourceRange: VideoModeSourceRange;
};

export type VideoModeControls = {
  /**
   * Run invisible video bookkeeping and write the elapsed span as dead air.
   */
  deadAir<T>(action: () => Promise<T>): Promise<T>;
  /** Milliseconds since video-mode started recording metadata for this test. */
  getVideoTimestamp(): number;
  /** Parsed video-mode metadata JSON after the test, or the current in-memory snapshot during the test. */
  metadata(): Promise<VideoModeMetadata>;
  /** Absolute artifact paths for the current test's video-mode outputs. */
  outputPaths(): VideoModeOutputPaths;
  /** Render the video from this source timestamp, in ms. Defaults to the current video timestamp. */
  setStartTime(ms?: number): void;
  /** Render the video until this source timestamp, in ms. Defaults to the current video timestamp. */
  setEndTime(ms?: number): void;
};

export type VideoModePageExtension = {
  videoMode: VideoModeControls;
};

export type VideoModePlugin = Plugin<VideoModePageExtension> & VideoModeControls;

export type VideoModeOutlineHighlightStyle = `${number}px solid ${string}`;

export type VideoModeHighlightOptions =
  | boolean
  | {
      /** Highlight duration in the rendered video (ms). Default: 1000 */
      duration?: number;
      mode: "pointer";
    }
  | {
      /** Highlight duration in the rendered video (ms). Default: 1000 */
      duration?: number;
      mode: "outline";
      /** Outline style for the rendered video. Default: '3px solid gold' */
      style?: VideoModeOutlineHighlightStyle;
    };

export type VideoModeOptions = {
  /**
   * Render action annotations. `true` uses pointer mode with default options.
   * Default: true
   */
  highlight?: VideoModeHighlightOptions;
  /** Final hold duration in the rendered video (ms). Default: 3000 */
  finalHold?: number;
  /** Methods to skip highlighting. Default: ['waitFor'] */
  skipMethods?: OverrideableMethod[];
  /**
   * Skip highlighting for actions triggered from these files (matched as
   * substrings of stack frames). Useful for internal helpers like login
   * flows that shouldn't be slowed down. Default: []
   */
  skipStackFrames?: string[];
  /**
   * Maximum rendered duration for each dead-air span. Longer spans are sped up
   * so they fit within this duration.
   */
  deadAirThreshold?: number;
};

type VideoModeState = {
  deadAirDepth: number;
  deadAirSpans: VideoModeSpan[];
  highlights: VideoModeHighlight[];
  highlightImageIndex: number;
  outputs: VideoModeOutputs;
  sourceRange: VideoModeSourceRange;
  startedAt?: number;
};

type RenderVideoSegment = {
  start: number;
  end: number;
  speed: number;
};

type VideoInfo = {
  width: number;
  height: number;
  durationMs: number;
};

type VideoFilter = {
  outputLabel: string;
  value: string;
};

type VideoPiece = {
  end: number;
  highlight?: VideoModeHighlight;
  speed: number;
  start: number;
};

type RenderedVideoPiece = VideoPiece & {
  outputEnd: number;
  outputStart: number;
};

type CursorWaypoint = {
  at: number;
  x: number;
  y: number;
};

type CursorTarget = {
  actionEnd?: number;
  method?: OverrideableMethod;
  outputEnd: number;
  outputStart: number;
  point: { x: number; y: number };
};

type HighlightInput = {
  durationMs: number;
  image: string;
  inputIndex: number;
  path: string;
};

type PointerInput = {
  hotspot: { x: number; y: number };
  inputIndex: number;
  path: string;
  size: number;
  sourceSize: number;
};

type ResolvedVideoModeHighlight =
  | {
      color: string;
      durationMs: number;
      mode: "outline";
      thickness: number;
    }
  | {
      color: string;
      durationMs: number;
      mode: "pointer";
      thickness: number;
    }
  | {
      mode: "off";
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

const resolveNonNegativeNumber = (options: {
  defaultValue: number;
  name: string;
  value: number | undefined;
}) => {
  const value = options.value === undefined ? options.defaultValue : options.value;

  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${options.name} must be a non-negative number`);
  }

  return value;
};

const parseOutlineHighlightStyle = (style: VideoModeOutlineHighlightStyle) => {
  const match = /^([0-9]+(?:\.[0-9]+)?)px solid (.+)$/.exec(style.trim());

  if (!match) {
    throw new Error("videoMode highlight.style must look like '1px solid yellow'");
  }

  const thickness = Number(match[1]);
  const color = match[2].trim();

  if (!Number.isFinite(thickness) || thickness < 0 || color.length === 0) {
    throw new Error("videoMode highlight.style must look like '1px solid yellow'");
  }

  return { color, thickness };
};

const resolveVideoModeHighlight = (options: VideoModeOptions): ResolvedVideoModeHighlight => {
  const rawHighlight = options.highlight === undefined ? true : options.highlight;

  if (rawHighlight === false) {
    return { mode: "off" };
  }

  if (rawHighlight === true) {
    return {
      color: "gold",
      durationMs: resolveNonNegativeNumber({
        defaultValue: 1000,
        name: "videoMode highlight.duration",
        value: undefined,
      }),
      mode: "pointer",
      thickness: 3,
    };
  }

  if (!rawHighlight || typeof rawHighlight !== "object" || !("mode" in rawHighlight)) {
    throw new Error("videoMode highlight must be true, false, or a highlight options object");
  }

  const durationMs = resolveNonNegativeNumber({
    defaultValue: 1000,
    name: "videoMode highlight.duration",
    value: rawHighlight.duration,
  });

  if (rawHighlight.mode === "pointer") {
    return {
      color: "gold",
      durationMs,
      mode: "pointer",
      thickness: 3,
    };
  }

  if (rawHighlight.mode === "outline") {
    const parsed = parseOutlineHighlightStyle(rawHighlight.style || "3px solid gold");

    return {
      color: parsed.color,
      durationMs,
      mode: "outline",
      thickness: parsed.thickness,
    };
  }

  throw new Error("videoMode highlight.mode must be 'pointer' or 'outline'");
};

const resolveVideoTimestamp = (name: string, ms: number) => {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error(`videoMode.${name}() requires a non-negative timestamp`);
  }

  return Math.round(ms);
};

const normalizeSourceRange = (sourceRange: VideoModeSourceRange): VideoModeSourceRange => {
  const normalized: VideoModeSourceRange = {};

  if (sourceRange.start !== undefined) {
    normalized.start = Math.round(sourceRange.start);
  }

  if (sourceRange.end !== undefined) {
    normalized.end = Math.round(sourceRange.end);
  }

  return normalized;
};

const sourceRangeIsSet = (sourceRange: VideoModeSourceRange) => {
  return sourceRange.start !== undefined || sourceRange.end !== undefined;
};

const metadataFor = (state: VideoModeState): VideoModeMetadata => {
  return {
    deadAir: mergeVideoSpans(state.deadAirSpans),
    highlights: normalizeVideoHighlights(state.highlights),
    outputs: state.outputs,
    schemaVersion: 1,
    sourceRange: normalizeSourceRange(state.sourceRange),
    timebase: "ms",
  };
};

const videoModeOutputPaths = (testInfo: TestInfo): VideoModeOutputPaths => {
  return {
    metadata: join(testInfo.outputDir, VIDEO_MODE_METADATA_FILE),
    player: join(testInfo.outputDir, VIDEO_MODE_PLAYER_FILE),
    raw: join(testInfo.outputDir, VIDEO_MODE_RAW_FILE),
    rendered: join(testInfo.outputDir, VIDEO_MODE_RENDERED_FILE),
    reportPlayer: join(testInfo.outputDir, VIDEO_MODE_REPORT_PLAYER_FILE),
  };
};

const readVideoModeMetadata = async (
  path: string,
  fallback: () => VideoModeMetadata,
): Promise<VideoModeMetadata> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as VideoModeMetadata;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return fallback();
    }

    throw error;
  }
};

const recordHighlight = async (options: {
  color: string;
  durationMs: number;
  locator: Locator;
  method: OverrideableMethod;
  state: VideoModeState;
  testInfo: TestInfo;
  thickness: number;
}) => {
  if (options.state.startedAt === undefined || options.durationMs <= 0) {
    return;
  }

  if (!(await locatorIsAttached(options.locator))) {
    return;
  }

  try {
    const snapshot = await options.locator.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        rect: {
          height: rect.height,
          width: rect.width,
          x: rect.left,
          y: rect.top,
        },
        viewport: {
          height: window.innerHeight,
          width: window.innerWidth,
        },
      };
    });

    if (
      snapshot.rect.width <= 0 ||
      snapshot.rect.height <= 0 ||
      snapshot.viewport.width <= 0 ||
      snapshot.viewport.height <= 0
    ) {
      return;
    }

    const image = `video-mode-highlight-${options.state.highlightImageIndex}.png`;
    options.state.highlightImageIndex += 1;
    const imagePath = join(options.testInfo.outputDir, image);
    await mkdir(options.testInfo.outputDir, { recursive: true });
    await options.locator.page().screenshot({ path: imagePath, scale: "css" });

    const start = Math.round(performance.now() - options.state.startedAt);
    const highlight: VideoModeHighlight = {
      color: options.color,
      end: start + Math.round(options.durationMs),
      image,
      method: options.method,
      rect: snapshot.rect,
      start,
      thickness: options.thickness,
      viewport: snapshot.viewport,
    };
    options.state.highlights.push(highlight);
    return highlight;
  } catch {
    // Element may disappear between the actionability wait and the snapshot.
  }
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
  if (state.startedAt === undefined || state.deadAirDepth > 0) {
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

const normalizeVideoHighlights = (highlights: VideoModeHighlight[]) => {
  return highlights
    .map((highlight) => ({
      ...highlight,
      actionEnd:
        highlight.actionEnd === undefined
          ? undefined
          : Math.max(Math.round(highlight.actionEnd), Math.round(highlight.start)),
      end: Math.round(highlight.end),
      rect: {
        height: Math.round(highlight.rect.height),
        width: Math.round(highlight.rect.width),
        x: Math.round(highlight.rect.x),
        y: Math.round(highlight.rect.y),
      },
      start: Math.round(highlight.start),
      thickness: Math.round(highlight.thickness),
      viewport: {
        height: Math.round(highlight.viewport.height),
        width: Math.round(highlight.viewport.width),
      },
    }))
    .filter((highlight) => highlight.end > highlight.start)
    .filter((highlight) => highlight.rect.width > 0 && highlight.rect.height > 0)
    .filter((highlight) => highlight.viewport.width > 0 && highlight.viewport.height > 0)
    .sort((left, right) => left.start - right.start || left.end - right.end);
};

const formatSeconds = (ms: number) => {
  const value = (ms / 1000).toFixed(3).replace(/\.?0+$/, "");
  return value || "0";
};

const formatFilterNumber = (value: number) => {
  return Number(value.toFixed(6)).toString();
};

const clipVideoSpan = (span: VideoModeSpan, range: VideoModeSpan): VideoModeSpan | undefined => {
  const start = Math.max(range.start, Math.min(Math.round(span.start), range.end));
  const end = Math.max(range.start, Math.min(Math.round(span.end), range.end));

  if (end <= start) {
    return undefined;
  }

  return { end, start };
};

const videoSpansOverlap = (left: VideoModeSpan, right: VideoModeSpan) => {
  return left.start < right.end && right.start < left.end;
};

const deadAirSpeed = (span: VideoModeSpan, thresholdMs: number) => {
  const duration = span.end - span.start;

  if (duration <= thresholdMs) {
    return 1;
  }

  if (thresholdMs === 0) {
    return Infinity;
  }

  return duration / thresholdMs;
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

const recordAttachedWaitFromTiming = (
  state: VideoModeState,
  timing: { actionStartedAt: number; attachedAt?: number; attachedAtStart: boolean },
) => {
  if (state.startedAt === undefined || timing.attachedAtStart) {
    return;
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
  if (state.startedAt === undefined) {
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

const renderVideoSegments = (options: {
  deadAir: VideoModeSpan[];
  finalEnd: number;
  start: number;
  thresholdMs?: number;
}): RenderVideoSegment[] => {
  const finalEnd = Math.max(0, Math.round(options.finalEnd));
  const start = Math.max(0, Math.min(Math.round(options.start), finalEnd));

  if (finalEnd <= start) {
    return [];
  }

  if (options.thresholdMs === undefined) {
    return [{ end: finalEnd, speed: 1, start }];
  }

  const thresholdMs = options.thresholdMs;
  const deadAir = mergeVideoSpans(
    options.deadAir
      .map((span) => clipVideoSpan(span, { end: finalEnd, start }))
      .filter((span): span is VideoModeSpan => Boolean(span)),
  );
  const boundaries = new Set([start, finalEnd]);

  for (const span of deadAir) {
    boundaries.add(span.start);
    boundaries.add(span.end);
  }

  const sortedBoundaries = [...boundaries].sort((left, right) => left - right);
  const segments: RenderVideoSegment[] = [];

  for (let index = 0; index < sortedBoundaries.length - 1; index += 1) {
    const start = sortedBoundaries[index];
    const end = sortedBoundaries[index + 1];

    if (end <= start) {
      continue;
    }

    const deadAirSpan = deadAir.find((span) => videoSpansOverlap(span, { end, start }));
    const speed = deadAirSpan ? deadAirSpeed(deadAirSpan, thresholdMs) : 1;

    if (!Number.isFinite(speed)) {
      continue;
    }

    const previous = segments[segments.length - 1];

    if (previous && previous.end === start && previous.speed === speed) {
      previous.end = end;
      continue;
    }

    segments.push({ end, speed, start });
  }

  return segments;
};

const videoPieces = (options: {
  highlights: VideoModeHighlight[];
  segments: RenderVideoSegment[];
}): VideoPiece[] => {
  const pieces: VideoPiece[] = [];
  const frameMs = 50;

  for (const segment of options.segments) {
    let cursor = segment.start;
    const highlights = options.highlights.filter(
      (highlight) => highlight.start >= segment.start && highlight.start < segment.end,
    );

    for (const highlight of highlights) {
      if (highlight.start > cursor) {
        pieces.push({ end: highlight.start, speed: segment.speed, start: cursor });
      }

      let frameStart = Math.max(segment.start, highlight.start - frameMs);
      let frameEnd = highlight.start;

      if (frameEnd <= frameStart) {
        frameStart = highlight.start;
        frameEnd = Math.min(segment.end, frameStart + frameMs);
      }

      if (frameEnd > frameStart) {
        pieces.push({ end: frameEnd, highlight, speed: segment.speed, start: frameStart });
      }

      cursor = highlight.start;
    }

    if (segment.end > cursor) {
      pieces.push({ end: segment.end, speed: segment.speed, start: cursor });
    }
  }

  return pieces.filter((piece) => piece.end > piece.start);
};

const scaleHighlight = (highlight: VideoModeHighlight, video: { width: number; height: number }) => {
  const scale = Math.min(
    video.width / highlight.viewport.width,
    video.height / highlight.viewport.height,
  );
  const x = Math.max(0, Math.round(highlight.rect.x * scale));
  const y = Math.max(0, Math.round(highlight.rect.y * scale));
  const width = Math.max(1, Math.round(highlight.rect.width * scale));
  const height = Math.max(1, Math.round(highlight.rect.height * scale));

  return {
    height: Math.min(height, Math.max(1, video.height - y)),
    width: Math.min(width, Math.max(1, video.width - x)),
    x,
    y,
  };
};

const scaledViewportSize = (
  viewport: VideoModeViewport,
  video: { width: number; height: number },
) => {
  const scale = Math.min(video.width / viewport.width, video.height / viewport.height);

  return {
    height: Math.max(1, Math.round(viewport.height * scale)),
    width: Math.max(1, Math.round(viewport.width * scale)),
  };
};

const drawboxFilter = (highlight: VideoModeHighlight, video: { width: number; height: number }) => {
  const rect = scaleHighlight(highlight, video);
  return [
    `drawbox=x=${rect.x}`,
    `y=${rect.y}`,
    `w=${rect.width}`,
    `h=${rect.height}`,
    `color=${highlight.color}`,
    `t=${Math.max(1, Math.round(highlight.thickness))}`,
  ].join(":");
};

const renderedPieceDuration = (piece: VideoPiece) => {
  const sourceDuration = (piece.end - piece.start) / piece.speed;

  if (!piece.highlight) {
    return sourceDuration;
  }

  const highlightDuration = piece.highlight.end - piece.highlight.start;

  if (piece.highlight.image) {
    return highlightDuration;
  }

  return Math.max(sourceDuration, highlightDuration);
};

const renderedVideoPieces = (pieces: VideoPiece[]) => {
  let cursor = 0;
  const rendered: RenderedVideoPiece[] = [];

  for (const piece of pieces) {
    const duration = renderedPieceDuration(piece);
    rendered.push({
      ...piece,
      outputEnd: cursor + duration,
      outputStart: cursor,
    });
    cursor += duration;
  }

  return rendered;
};

const sourceTimeToRenderedTime = (pieces: RenderedVideoPiece[], sourceTime: number) => {
  for (const piece of pieces) {
    if (piece.highlight?.image) {
      continue;
    }

    if (sourceTime >= piece.start && sourceTime <= piece.end) {
      return piece.outputStart + (sourceTime - piece.start) / piece.speed;
    }
  }

  return undefined;
};

const highlightCursorPoint = (
  highlight: VideoModeHighlight,
  video: { width: number; height: number },
) => {
  const rect = scaleHighlight(highlight, video);

  return {
    x: Math.max(0, Math.min(video.width - 1, rect.x + rect.width / 2)),
    y: Math.max(0, Math.min(video.height - 1, rect.y + rect.height / 2)),
  };
};

const pushCursorWaypoint = (waypoints: CursorWaypoint[], waypoint: CursorWaypoint) => {
  const rounded = {
    at: Math.round(waypoint.at),
    x: Math.round(waypoint.x),
    y: Math.round(waypoint.y),
  };
  const previous = waypoints[waypoints.length - 1];

  if (previous && previous.at === rounded.at) {
    previous.x = rounded.x;
    previous.y = rounded.y;
    return;
  }

  waypoints.push(rounded);
};

const cursorTargets = (options: {
  highlights: VideoModeHighlight[];
  pieces: RenderedVideoPiece[];
  video: { width: number; height: number };
}) => {
  const targets: CursorTarget[] = [];

  for (const highlight of options.highlights) {
    const piece = options.pieces.find((candidate) => candidate.highlight === highlight);

    if (!piece) {
      continue;
    }

    targets.push({
      actionEnd:
        highlight.actionEnd === undefined
          ? undefined
          : sourceTimeToRenderedTime(options.pieces, highlight.actionEnd),
      method: highlight.method,
      outputEnd: piece.outputEnd,
      outputStart: piece.outputStart,
      point: highlightCursorPoint(highlight, options.video),
    });
  }

  return targets;
};

const cursorWaypoints = (targets: CursorTarget[], video: { width: number; height: number }) => {
  const waypoints: CursorWaypoint[] = [];

  if (targets.length > 0 && targets[0].outputStart > 0) {
    pushCursorWaypoint(waypoints, {
      at: 0,
      x: video.width / 2,
      y: video.height / 2,
    });
  }

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const nextTarget = targets[index + 1];
    const targetHoldEnd =
      target.actionEnd === undefined ? target.outputEnd : Math.max(target.outputEnd, target.actionEnd);
    const holdEnd = nextTarget
      ? Math.min(targetHoldEnd, nextTarget.outputStart)
      : targetHoldEnd;

    pushCursorWaypoint(waypoints, {
      at: target.outputStart,
      x: target.point.x,
      y: target.point.y,
    });
    pushCursorWaypoint(waypoints, {
      at: holdEnd,
      x: target.point.x,
      y: target.point.y,
    });

    if (nextTarget && nextTarget.outputStart > holdEnd) {
      pushCursorWaypoint(waypoints, {
        at: nextTarget.outputStart,
        x: nextTarget.point.x,
        y: nextTarget.point.y,
      });
    }
  }

  return waypoints;
};

const clickHoldSpans = (targets: CursorTarget[]) => {
  return targets
    .filter((target) => target.method === "click")
    .map((target) => ({
      end: target.outputEnd,
      start: target.outputStart,
    }))
    .filter((span) => span.end > span.start);
};

const cursorActivitySpan = (
  targets: CursorTarget[],
  waypoints: CursorWaypoint[],
): VideoModeSpan | undefined => {
  if (targets.length === 0 || waypoints.length === 0) {
    return undefined;
  }

  return {
    end: Math.max(...targets.map((target) => target.outputEnd)),
    start: waypoints[0].at,
  };
};

const cursorExpression = (waypoints: CursorWaypoint[], property: "x" | "y") => {
  let expression = formatFilterNumber(waypoints[waypoints.length - 1][property]);

  for (let index = waypoints.length - 2; index >= 0; index -= 1) {
    const from = waypoints[index];
    const to = waypoints[index + 1];

    if (to.at <= from.at) {
      continue;
    }

    const start = formatSeconds(from.at);
    const end = formatSeconds(to.at);
    const progress = `((t-${start})/(${end}-${start}))`;
    const eased = `((${progress})*(${progress})*(3-2*(${progress})))`;
    const delta = to[property] - from[property];
    const value =
      delta === 0
        ? formatFilterNumber(from[property])
        : `(${formatFilterNumber(from[property])}+(${formatFilterNumber(delta)})*${eased})`;

    expression = `if(between(t\\,${start}\\,${end})\\,${value}\\,${expression})`;
  }

  return expression;
};

const cursorOverlayFilters = (options: {
  enable: string;
  inputLabel: string;
  outputLabel: string;
  pointerInput: PointerInput;
  waypoints: CursorWaypoint[];
}) => {
  if (options.waypoints.length === 0) {
    return `[${options.inputLabel}]null[${options.outputLabel}]`;
  }

  const pointerScale = options.pointerInput.size / options.pointerInput.sourceSize;
  const x = `(${cursorExpression(options.waypoints, "x")})-${formatFilterNumber(
    options.pointerInput.hotspot.x * pointerScale,
  )}`;
  const y = `(${cursorExpression(options.waypoints, "y")})-${formatFilterNumber(
    options.pointerInput.hotspot.y * pointerScale,
  )}`;

  return [
    `[${options.pointerInput.inputIndex}:v]scale=w=${options.pointerInput.size}:h=${options.pointerInput.size},format=rgba[pointercursor]`,
    [
      `[${options.inputLabel}][pointercursor]overlay=x='${x}'`,
      `y='${y}'`,
      "eval=frame",
      "eof_action=pass",
      `enable='${options.enable}'[${options.outputLabel}]`,
    ].join(":"),
  ].join(";");
};

const videoSpanExpression = (spans: VideoModeSpan[]) => {
  return spans
    .map((span) => `between(t\\,${formatSeconds(span.start)}\\,${formatSeconds(span.end)})`)
    .join("+");
};

const renderedVideoFilter = (options: {
  clickPointerInput?: PointerInput;
  cursorPointerInput?: PointerInput;
  finalHoldMs: number;
  highlightMode: "outline" | "pointer";
  highlightInputs: HighlightInput[];
  highlights: VideoModeHighlight[];
  segments: RenderVideoSegment[];
  video: { width: number; height: number };
}): VideoFilter | undefined => {
  const highlightInputByImage = new Map(
    options.highlightInputs.map((input) => [input.image, input]),
  );
  const pieces = videoPieces({
    highlights: options.highlights,
    segments: options.segments,
  });
  const renderedPieces = renderedVideoPieces(pieces);
  const targets = cursorTargets({
    highlights: options.highlights,
    pieces: renderedPieces,
    video: options.video,
  });
  const waypoints = cursorWaypoints(targets, options.video);
  const clickSpans = clickHoldSpans(targets);
  const activitySpan = cursorActivitySpan(targets, waypoints);
  const clickSpanExpression = videoSpanExpression(clickSpans);

  if (pieces.length === 0) {
    return undefined;
  }

  const filters: string[] = [];
  const labels: string[] = [];

  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index];
    const label = `render${index}`;
    labels.push(`[${label}]`);

    const operations: string[] = [];

    if (piece.highlight?.image && highlightInputByImage.has(piece.highlight.image)) {
      const input = highlightInputByImage.get(piece.highlight.image)!;
      const scaledViewport = scaledViewportSize(piece.highlight.viewport, options.video);
      operations.push(
        `[${input.inputIndex}:v]scale=w=${scaledViewport.width}:h=${scaledViewport.height}`,
      );
      operations.push(
        `pad=w=${options.video.width}:h=${options.video.height}:x=0:y=0:color=gray`,
      );
      if (options.highlightMode === "outline") {
        operations.push(drawboxFilter(piece.highlight, options.video));
      }
      operations.push(
        `trim=start=0:end=${formatSeconds(piece.highlight.end - piece.highlight.start)}`,
      );
      operations.push("setpts=PTS-STARTPTS");
    } else {
      operations.push(
        `[0:v]trim=start=${formatSeconds(piece.start)}:end=${formatSeconds(piece.end)}`,
      );
      operations.push(`setpts=(PTS-STARTPTS)/${formatFilterNumber(piece.speed)}`);
    }

    if (piece.highlight && !piece.highlight.image) {
      const sourceDuration = (piece.end - piece.start) / piece.speed;
      if (options.highlightMode === "outline") {
        operations.push(drawboxFilter(piece.highlight, options.video));
      }
      operations.push(
        `tpad=stop_mode=clone:stop_duration=${formatSeconds(
          Math.max(0, piece.highlight.end - piece.highlight.start - sourceDuration),
        )}`,
      );
    }

    filters.push(`${operations.join(",")}[${label}]`);
  }

  const concatLabel = labels.length === 1 ? labels[0].slice(1, -1) : "renderconcat";

  if (labels.length > 1) {
    filters.push(`${labels.join("")}concat=n=${labels.length}:v=1:a=0[${concatLabel}]`);
  }

  const finalHoldMs = Math.max(0, Math.round(options.finalHoldMs));
  const outputLabel = finalHoldMs > 0 ? "renderout" : concatLabel;

  if (finalHoldMs > 0) {
    filters.push(
      `[${concatLabel}]tpad=stop_mode=clone:stop_duration=${formatSeconds(finalHoldMs)}[${outputLabel}]`,
    );
  }

  if (
    options.highlightMode === "pointer" &&
    options.cursorPointerInput &&
    waypoints.length > 0 &&
    activitySpan
  ) {
    const cursorOutputLabel = "renderpointer";
    const cursorActivityExpression = `between(t\\,${formatSeconds(activitySpan.start)}\\,${formatSeconds(activitySpan.end)})`;
    const cursorEnable = clickSpanExpression
      ? `${cursorActivityExpression}*not(${clickSpanExpression})`
      : cursorActivityExpression;
    filters.push(
      cursorOverlayFilters({
        enable: cursorEnable,
        inputLabel: outputLabel,
        outputLabel: cursorOutputLabel,
        pointerInput: options.cursorPointerInput,
        waypoints,
      }),
    );

    if (options.clickPointerInput && clickSpanExpression) {
      const clickPointerOutputLabel = "renderclickpointer";
      filters.push(
        cursorOverlayFilters({
          enable: clickSpanExpression,
          inputLabel: cursorOutputLabel,
          outputLabel: clickPointerOutputLabel,
          pointerInput: options.clickPointerInput,
          waypoints,
        }),
      );

      return {
        outputLabel: clickPointerOutputLabel,
        value: filters.join(";"),
      };
    }

    return {
      outputLabel: cursorOutputLabel,
      value: filters.join(";"),
    };
  }

  return {
    outputLabel,
    value: filters.join(";"),
  };
};

const videoInfo = async (path: string): Promise<VideoInfo> => {
  const { stdout } = await execFile(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=width,height",
      "-of",
      "json",
      path,
    ],
    { maxBuffer: 1024 * 1024 },
  );
  const payload = JSON.parse(stdout);
  const seconds = Number(payload.format?.duration);
  const stream = payload.streams?.find((candidate: any) => candidate.width && candidate.height);

  if (!Number.isFinite(seconds) || seconds <= 0 || !stream) {
    throw new Error(`Could not read video duration from ffprobe output: ${stdout}`);
  }

  return {
    durationMs: Math.round(seconds * 1000),
    height: Number(stream.height),
    width: Number(stream.width),
  };
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

const escapeHtml = (value: string) => {
  const entities: Record<string, string> = {
    "&": "&amp;",
    '"': "&quot;",
    "'": "&#39;",
    "<": "&lt;",
    ">": "&gt;",
  };

  return value.replace(/[&"'<>]/g, (character) => entities[character]);
};

const videoElementHtml = (options: { label: string; source: string }) => {
  const label = escapeHtml(options.label);
  const source = escapeHtml(options.source);

  return `
      <section class="video-section">
        <div class="section-title">${label}</div>
        <video controls preload="metadata" tabindex="0">
          <source src="${source}" type="video/webm" />
        </video>
      </section>`;
};

const playwrightReportAttachmentName = async (path: string) => {
  const data = await readFile(path);
  return `${createHash("sha1").update(data).digest("hex")}${extname(path)}`;
};

const videoModePlayerHtml = (options: { raw: string; rendered?: string }) => {
  const primary = options.rendered || options.raw;
  const primaryLabel = options.rendered ? "Rendered video" : "Raw video";
  const rawDetails = options.rendered
    ? `
      <details>
        <summary>Raw video</summary>
        ${videoElementHtml({ label: "Raw video", source: options.raw })}
      </details>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>video-mode player</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #111;
      color: #eee;
    }

    body {
      margin: 0;
      min-height: 100vh;
      background: #111;
    }

    header {
      align-items: center;
      background: #1d1d1d;
      border-bottom: 1px solid #333;
      display: grid;
      gap: 12px;
      grid-template-columns: 1fr auto auto auto;
      padding: 10px 12px;
      position: sticky;
      top: 0;
      z-index: 1;
    }

    main {
      display: grid;
      gap: 14px;
      grid-template-columns: minmax(0, 1fr) 260px;
      padding: 12px;
    }

    video {
      background: #000;
      max-height: calc(100vh - 92px);
      outline: 1px solid #333;
      width: 100%;
    }

    label,
    button,
    input {
      font: inherit;
    }

    input {
      background: #050505;
      border: 1px solid #555;
      color: #eee;
      padding: 6px 8px;
      width: 72px;
    }

    button {
      background: #333;
      border: 1px solid #666;
      color: #eee;
      cursor: pointer;
      padding: 6px 10px;
    }

    aside {
      color: #ddd;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 13px;
      line-height: 1.5;
    }

    details {
      border-top: 1px solid #333;
      margin-top: 14px;
      padding-top: 12px;
    }

    summary {
      cursor: pointer;
      margin-bottom: 12px;
    }

    a {
      color: #9ecbff;
    }

    .section-title {
      color: #aaa;
      font-size: 13px;
      margin-bottom: 8px;
    }

    .hint {
      color: #aaa;
      margin-top: 12px;
    }

    @media (max-width: 820px) {
      header,
      main {
        grid-template-columns: 1fr;
      }

      video {
        max-height: none;
      }
    }
  </style>
</head>
<body>
  <header>
    <div>video-mode player</div>
    <label>fps <input id="fps" type="number" min="1" step="1" value="25" /></label>
    <button id="back" type="button">-1 frame</button>
    <button id="forward" type="button">+1 frame</button>
  </header>
  <main>
    <div>
      ${videoElementHtml({ label: primaryLabel, source: primary })}
      ${rawDetails}
    </div>
    <aside>
      <div>active: <span id="active">-</span></div>
      <div>time: <span id="time">0.000</span>s</div>
      <div>frame: <span id="frame">0</span></div>
      <div>duration: <span id="duration">?</span>s</div>
      <div class="hint">Left/right steps one frame. Shift+left/right steps ten. Space toggles play.</div>
      <div class="hint"><a href="${VIDEO_MODE_METADATA_FILE}">${VIDEO_MODE_METADATA_FILE}</a></div>
    </aside>
  </main>
  <script>
    const videos = Array.from(document.querySelectorAll("video"));
    const fps = document.querySelector("#fps");
    const active = document.querySelector("#active");
    const time = document.querySelector("#time");
    const frame = document.querySelector("#frame");
    const duration = document.querySelector("#duration");
    let activeVideo = videos[0];

    const setActiveVideo = (video) => {
      activeVideo = video;
      update();
    };

    const update = () => {
      const rate = Number(fps.value) || 25;
      const title = activeVideo.closest(".video-section").querySelector(".section-title").textContent;
      active.textContent = title;
      time.textContent = activeVideo.currentTime.toFixed(3);
      frame.textContent = String(Math.round(activeVideo.currentTime * rate));
      duration.textContent = Number.isFinite(activeVideo.duration) ? activeVideo.duration.toFixed(3) : "?";
    };

    const stepFrames = (count) => {
      const rate = Number(fps.value) || 25;
      activeVideo.pause();
      activeVideo.currentTime = Math.max(
        0,
        Math.min(activeVideo.duration || Infinity, activeVideo.currentTime + count / rate),
      );
    };

    for (const video of videos) {
      video.addEventListener("focus", () => setActiveVideo(video));
      video.addEventListener("pointerdown", () => setActiveVideo(video));
      video.addEventListener("mouseenter", () => setActiveVideo(video));
      video.addEventListener("loadedmetadata", update);
      video.addEventListener("seeked", update);
      video.addEventListener("timeupdate", update);
    }

    document.querySelector("#back").addEventListener("click", () => stepFrames(-1));
    document.querySelector("#forward").addEventListener("click", () => stepFrames(1));
    document.addEventListener("keydown", (event) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        stepFrames(event.shiftKey ? 10 : 1);
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        stepFrames(event.shiftKey ? -10 : -1);
      }
      if (event.key === " ") {
        event.preventDefault();
        if (activeVideo.paused) activeVideo.play();
        else activeVideo.pause();
      }
    });

    update();
  </script>
</body>
</html>
`;
};

const renderVideo = async (options: {
  finalHoldMs: number;
  highlightMode: "outline" | "pointer";
  highlights: VideoModeHighlight[];
  inputPath: string;
  outputDir: string;
  outputPath: string;
  deadAir: VideoModeSpan[];
  sourceRange: VideoModeSourceRange;
  thresholdMs: number | undefined;
}) => {
  const info = await videoInfo(options.inputPath);
  const rangeStart = Math.max(0, Math.min(Math.round(options.sourceRange.start || 0), info.durationMs));
  const rangeEnd = Math.max(
    0,
    Math.min(Math.round(options.sourceRange.end || info.durationMs), info.durationMs),
  );

  if (rangeEnd <= rangeStart) {
    throw new Error(
      `videoMode source range is empty: start ${rangeStart}ms must be before end ${rangeEnd}ms`,
    );
  }

  const highlightInputs = options.highlights
    .filter((highlight) => highlight.image)
    .map((highlight, index) => ({
      durationMs: highlight.end - highlight.start,
      image: highlight.image!,
      inputIndex: index + 1,
      path: join(options.outputDir, highlight.image!),
    }));
  const shouldRenderPointer = options.highlightMode === "pointer" && options.highlights.length > 0;
  const cursorPointerInput: PointerInput | undefined = shouldRenderPointer
    ? {
        hotspot: VIDEO_MODE_POINTER_HOTSPOT,
        inputIndex: highlightInputs.length + 1,
        path: join(options.outputDir, VIDEO_MODE_POINTER_FILE),
        size: VIDEO_MODE_POINTER_SIZE,
        sourceSize: VIDEO_MODE_POINTER_SOURCE_SIZE,
      }
    : undefined;
  const clickPointerInput: PointerInput | undefined = shouldRenderPointer
    ? {
        hotspot: VIDEO_MODE_CLICK_POINTER_HOTSPOT,
        inputIndex: highlightInputs.length + 2,
        path: join(options.outputDir, VIDEO_MODE_CLICK_POINTER_FILE),
        size: VIDEO_MODE_CLICK_POINTER_SIZE,
        sourceSize: VIDEO_MODE_CLICK_POINTER_SOURCE_SIZE,
      }
    : undefined;
  if (cursorPointerInput) {
    await writeFile(cursorPointerInput.path, Buffer.from(VIDEO_MODE_POINTER_PNG, "base64"));
  }
  if (clickPointerInput) {
    await writeFile(clickPointerInput.path, Buffer.from(VIDEO_MODE_CLICK_POINTER_PNG, "base64"));
  }
  const segments = renderVideoSegments({
    deadAir: options.deadAir,
    finalEnd: rangeEnd,
    start: rangeStart,
    thresholdMs: options.thresholdMs,
  });
  const filter = renderedVideoFilter({
    clickPointerInput,
    cursorPointerInput,
    finalHoldMs: options.finalHoldMs,
    highlightMode: options.highlightMode,
    highlightInputs,
    highlights: options.highlights,
    segments,
    video: info,
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
      ...highlightInputs.flatMap((input) => [
        "-loop",
        "1",
        "-t",
        formatSeconds(input.durationMs),
        "-i",
        input.path,
      ]),
      ...(cursorPointerInput ? ["-loop", "1", "-i", cursorPointerInput.path] : []),
      ...(clickPointerInput ? ["-loop", "1", "-i", clickPointerInput.path] : []),
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

/** Records video-mode facts and renders annotations into the recorded video. */
export const videoMode = (options: VideoModeOptions = {}): VideoModePlugin => {
  if (process.env.PWDEBUG) {
    let testInfoForOutputPaths: TestInfo | undefined;
    const controls: VideoModeControls = {
      deadAir: async (action) => {
        return await action();
      },
      getVideoTimestamp: () => 0,
      metadata: async () => ({
        deadAir: [],
        highlights: [],
        outputs: {},
        schemaVersion: 1,
        sourceRange: {},
        timebase: "ms",
      }),
      outputPaths: () => {
        if (!testInfoForOutputPaths) {
          throw new Error("videoMode.outputPaths() is only available after addPlugins registers videoMode");
        }

        return videoModeOutputPaths(testInfoForOutputPaths);
      },
      setEndTime: () => {},
      setStartTime: () => {},
    };

    return {
      ...controls,
      name: "video-mode",
      pageExtension: ({ testInfo }) => {
        testInfoForOutputPaths = testInfo;
        return { videoMode: controls };
      },
    };
  }

  const finalHold = resolveNonNegativeNumber({
    defaultValue: 3000,
    name: "videoMode finalHold",
    value: options.finalHold,
  });
  const highlight = resolveVideoModeHighlight(options);
  const skipMethods = options.skipMethods || ["waitFor"];
  const skipStackFrames = options.skipStackFrames || [];
  const deadAirThreshold = resolveDeadAirThreshold(options.deadAirThreshold);
  const state: VideoModeState = {
    deadAirDepth: 0,
    deadAirSpans: [],
    highlightImageIndex: 0,
    highlights: [],
    outputs: {},
    sourceRange: {},
    startedAt: performance.now(),
  };
  let testInfoForOutputPaths: TestInfo | undefined;
  const getVideoTimestamp = () => {
    const now = performance.now();
    return Math.round(now - (state.startedAt || now));
  };
  const controls: VideoModeControls = {
    deadAir: async (action) => {
      return await recordDeadAir(state, action);
    },
    getVideoTimestamp,
    metadata: async () => {
      if (!testInfoForOutputPaths) {
        return metadataFor(state);
      }

      return await readVideoModeMetadata(videoModeOutputPaths(testInfoForOutputPaths).metadata, () =>
        metadataFor(state),
      );
    },
    outputPaths: () => {
      if (!testInfoForOutputPaths) {
        throw new Error("videoMode.outputPaths() is only available after addPlugins registers videoMode");
      }

      return videoModeOutputPaths(testInfoForOutputPaths);
    },
    setEndTime: (ms = getVideoTimestamp()) => {
      state.sourceRange.end = resolveVideoTimestamp("setEndTime", ms);
    },
    setStartTime: (ms = getVideoTimestamp()) => {
      state.sourceRange.start = resolveVideoTimestamp("setStartTime", ms);
    },
  };

  return {
    ...controls,
    name: "video-mode",
    pageExtension: ({ testInfo }) => {
      testInfoForOutputPaths = testInfo;
      return { videoMode: controls };
    },

    middleware: async ({ args, locator, method, testInfo, timing }, next) => {
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
          recordAttachedWaitFromTiming(state, timing);
        }
      }

      recordMiddlewareWaitBeforeVideoMode(state, timing);

      if (skipMethods.includes(method)) {
        try {
          return await next();
        } finally {
          recordAttachedWaitFromTiming(state, timing);
        }
      }

      const recordedHighlight =
        highlight.mode === "off"
          ? undefined
          : await recordHighlight({
              color: highlight.color,
              durationMs: highlight.durationMs,
              locator,
              method,
              state,
              testInfo,
              thickness: highlight.thickness,
            });

      try {
        return await next();
      } finally {
        if (recordedHighlight && state.startedAt !== undefined) {
          recordedHighlight.actionEnd = Math.max(
            recordedHighlight.start,
            Math.round(performance.now() - state.startedAt),
          );
        }
        recordAttachedWaitFromTiming(state, timing);
      }
    },

    testLifecycle: (emitter) => {
      const offBeforeTest = emitter.on("beforeTest", () => {
        state.deadAirDepth = 0;
        state.deadAirSpans = [];
        state.highlightImageIndex = 0;
        state.highlights = [];
        state.outputs = {};
        state.sourceRange = {};
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
        const metadataBeforeVideo = metadataFor(state);
        const deadAir = metadataBeforeVideo.deadAir;
        const highlights = metadataBeforeVideo.highlights;
        const sourceRange = metadataBeforeVideo.sourceRange;
        const video = page.video();

        if (video) {
          const paths = videoModeOutputPaths(testInfo);
          await mkdir(testInfo.outputDir, { recursive: true });

          if (!page.isClosed()) {
            await page.close({ runBeforeUnload: false });
          }

          const recordedVideoPath = await video.path();
          await waitForNonEmptyFile(recordedVideoPath);
          await copyFile(recordedVideoPath, paths.raw);
          state.outputs.raw = VIDEO_MODE_RAW_FILE;
          await testInfo.attach("video-raw", {
            contentType: "video/webm",
            path: paths.raw,
          });

          if (
            highlights.length > 0 ||
            deadAirThreshold !== undefined ||
            finalHold > 0 ||
            sourceRangeIsSet(sourceRange)
          ) {
            const wroteRenderedVideo = await renderVideo({
              deadAir,
              finalHoldMs: finalHold,
              highlightMode: highlight.mode === "pointer" ? "pointer" : "outline",
              highlights,
              inputPath: paths.raw,
              outputDir: testInfo.outputDir,
              outputPath: paths.rendered,
              sourceRange,
              thresholdMs: deadAirThreshold,
            });

            if (wroteRenderedVideo) {
              state.outputs.rendered = VIDEO_MODE_RENDERED_FILE;
              await testInfo.attach("video-rendered", {
                contentType: "video/webm",
                path: paths.rendered,
              });
            }
          }

          state.outputs.player = VIDEO_MODE_PLAYER_FILE;
          await writeFile(
            paths.player,
            videoModePlayerHtml({
              raw: state.outputs.raw,
              rendered: state.outputs.rendered,
            }),
          );

          const reportPlayerHtml = videoModePlayerHtml({
            raw: await playwrightReportAttachmentName(paths.raw),
            rendered: state.outputs.rendered
              ? await playwrightReportAttachmentName(paths.rendered)
              : undefined,
          });
          await writeFile(paths.reportPlayer, reportPlayerHtml);
          await testInfo.attach("video-mode-player", {
            contentType: "text/html",
            path: paths.reportPlayer,
          });
        }

        const metadata = metadataFor(state);
        if (
          metadata.deadAir.length > 0 ||
          metadata.highlights.length > 0 ||
          metadata.outputs.player ||
          metadata.outputs.raw ||
          metadata.outputs.rendered ||
          sourceRangeIsSet(metadata.sourceRange)
        ) {
          const path = videoModeOutputPaths(testInfo).metadata;
          await mkdir(testInfo.outputDir, { recursive: true });
          await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`);
          await testInfo.attach("video-mode", {
            contentType: "application/json",
            path,
          });
        }

        state.startedAt = undefined;
        console.log(`video-mode metadata written to ${videoModeOutputPaths(testInfo).metadata}`);
      });

      return () => {
        offBeforeTest();
        offAfterTest();
      };
    },
  };
};
