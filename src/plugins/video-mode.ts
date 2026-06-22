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
  color: string;
  image?: string;
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

export type VideoModeOptions = {
  /** Highlight duration in the rendered video (ms). Default: 1000 */
  highlightDuration?: number;
  /** Final hold duration in the rendered video (ms). Default: 3000 */
  finalHold?: number;
  /** Highlight color for the rendered video. Default: 'gold' */
  highlightColor?: string;
  /** Highlight outline thickness in the rendered video. Default: 3 */
  highlightThickness?: number;
  /** Methods to skip highlighting. Default: ['waitFor'] */
  skipMethods?: OverrideableMethod[];
  /**
   * Skip highlighting for actions triggered from these files (matched as
   * substrings of stack frames). Useful for internal helpers like login
   * flows that shouldn't be slowed down. Default: []
   */
  skipStackFrames?: string[];
  /**
   * Minimum amount of each dead-air span to keep in video-rendered.webm, split
   * evenly before and after the removed middle.
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

type TightVideoSegment = {
  start: number;
  end: number;
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
  start: number;
};

type HighlightInput = {
  durationMs: number;
  image: string;
  inputIndex: number;
  path: string;
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
    options.state.highlights.push({
      color: options.color,
      end: start + Math.round(options.durationMs),
      image,
      rect: snapshot.rect,
      start,
      thickness: options.thickness,
      viewport: snapshot.viewport,
    });
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

const clipVideoSpan = (span: VideoModeSpan, range: VideoModeSpan): VideoModeSpan | undefined => {
  const start = Math.max(range.start, Math.min(Math.round(span.start), range.end));
  const end = Math.max(range.start, Math.min(Math.round(span.end), range.end));

  if (end <= start) {
    return undefined;
  }

  return { end, start };
};

const trimDeadAirSpan = (options: {
  highlights: VideoModeHighlight[];
  span: VideoModeSpan;
  thresholdMs: number;
}): VideoModeSpan | undefined => {
  const span = options.span;
  const thresholdMs = options.thresholdMs;

  if (span.end - span.start <= thresholdMs) {
    return undefined;
  }

  const padding = thresholdMs / 2;
  // A following highlight already shows the post-wait state, so don't also
  // render an unhighlighted tail frame for the same transition.
  const followingHighlight = options.highlights.find((highlight) => {
    return highlight.start >= span.end && highlight.start - span.end <= thresholdMs;
  });
  const start = Math.round(span.start + padding);
  const end = Math.round(followingHighlight ? followingHighlight.start : span.end - padding);

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

const tightVideoSegments = (options: {
  deadAir: VideoModeSpan[];
  finalEnd: number;
  highlights: VideoModeHighlight[];
  start: number;
  thresholdMs?: number;
}): TightVideoSegment[] => {
  const finalEnd = Math.max(0, Math.round(options.finalEnd));
  const start = Math.max(0, Math.min(Math.round(options.start), finalEnd));

  if (finalEnd <= start) {
    return [];
  }

  if (options.thresholdMs === undefined) {
    return [{ end: finalEnd, start }];
  }

  const thresholdMs = options.thresholdMs;
  const highlights = normalizeVideoHighlights(options.highlights);
  const deadAir = mergeVideoSpans(
    options.deadAir
      .map((span) => clipVideoSpan(span, { end: finalEnd, start }))
      .filter((span): span is VideoModeSpan => Boolean(span))
      .map((span) => trimDeadAirSpan({ highlights, span, thresholdMs }))
      .filter((span): span is VideoModeSpan => Boolean(span)),
  );
  const boundaries = new Set([start, finalEnd]);

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

const videoPieces = (options: {
  highlights: VideoModeHighlight[];
  segments: TightVideoSegment[];
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
        pieces.push({ end: highlight.start, start: cursor });
      }

      let frameStart = Math.max(segment.start, highlight.start - frameMs);
      let frameEnd = highlight.start;

      if (frameEnd <= frameStart) {
        frameStart = highlight.start;
        frameEnd = Math.min(segment.end, frameStart + frameMs);
      }

      if (frameEnd > frameStart) {
        pieces.push({ end: frameEnd, highlight, start: frameStart });
      }

      cursor = highlight.start;
    }

    if (segment.end > cursor) {
      pieces.push({ end: segment.end, start: cursor });
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

const renderedVideoFilter = (options: {
  finalHoldMs: number;
  highlightInputs: HighlightInput[];
  highlights: VideoModeHighlight[];
  segments: TightVideoSegment[];
  video: { width: number; height: number };
}): VideoFilter | undefined => {
  const highlightInputByImage = new Map(
    options.highlightInputs.map((input) => [input.image, input]),
  );
  const pieces = videoPieces({
    highlights: options.highlights,
    segments: options.segments,
  });

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
      operations.push(drawboxFilter(piece.highlight, options.video));
      operations.push(
        `trim=start=0:end=${formatSeconds(piece.highlight.end - piece.highlight.start)}`,
      );
      operations.push("setpts=PTS-STARTPTS");
    } else {
      operations.push(
        `[0:v]trim=start=${formatSeconds(piece.start)}:end=${formatSeconds(piece.end)}`,
      );
      operations.push("setpts=PTS-STARTPTS");
    }

    if (piece.highlight && !piece.highlight.image) {
      const sourceDuration = piece.end - piece.start;
      operations.push(drawboxFilter(piece.highlight, options.video));
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
  const segments = tightVideoSegments({
    deadAir: options.deadAir,
    finalEnd: rangeEnd,
    highlights: options.highlights,
    start: rangeStart,
    thresholdMs: options.thresholdMs,
  });
  const filter = renderedVideoFilter({
    finalHoldMs: options.finalHoldMs,
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
  const highlightDuration = resolveNonNegativeNumber({
    defaultValue: 1000,
    name: "videoMode highlightDuration",
    value: options.highlightDuration,
  });
  const finalHold = resolveNonNegativeNumber({
    defaultValue: 3000,
    name: "videoMode finalHold",
    value: options.finalHold,
  });
  const highlightColor = options.highlightColor || "gold";
  const highlightThickness = options.highlightThickness || 3;
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

      try {
        await recordHighlight({
          color: highlightColor,
          durationMs: highlightDuration,
          locator,
          state,
          testInfo,
          thickness: highlightThickness,
        });
        return await next();
      } finally {
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
