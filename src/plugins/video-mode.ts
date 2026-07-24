/**
 * video-mode: record action timings and render watchable videos after the run.
 *
 * Extracted from the iterate monorepo's internal Playwright test
 * infrastructure (github.com/iterate/iterate, private). Modification from the
 * original: the hardcoded skip for iterate's test-helpers file is now the
 * `skipStackFrames` option.
 *
 * Caption span capture and ASS rendering are adapted from
 * `../agents/examples/macwright.ts`. This version observes Playwright
 * `test.step`, normalizes nested spans, and projects captions through video
 * mode's trimming, highlight holds, and dead-air compression.
 */
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import type { Dialog, Locator, Page, TestInfo } from "@playwright/test";
import type {
  ActionTiming,
  LocatorWithOriginal,
  Plugin,
  OverrideableMethod,
} from "../plugin-system.ts";

const execFile = promisify(execFileCallback);
const VIDEO_MODE_METADATA_FILE = "video-mode.json";
const VIDEO_MODE_PLAYER_FILE = "video-mode.html";
const VIDEO_MODE_RAW_FILE = "video-raw.webm";
const VIDEO_MODE_RENDERED_FILE = "video-rendered.webm";
const VIDEO_MODE_REPORT_PLAYER_FILE = "video-mode-report.html";
const VIDEO_MODE_POINTER_FILE = "video-mode-pointer.png";
const VIDEO_MODE_CLICK_POINTER_FILE = "video-mode-click-pointer.png";
const VIDEO_MODE_TEXT_POINTER_FILE = "video-mode-text-pointer.png";
const VIDEO_MODE_DIALOG_POST_FRAME_FILE = "video-mode-dialog-post-frame.png";
const VIDEO_MODE_CAPTIONS_FILE = "video-mode-captions.ass";
const VIDEO_MODE_DIALOG_ATTRIBUTE = "data-middlewright-video-mode-dialog";
const VIDEO_MODE_HIGHLIGHT_FRAME_MS = 50;
// Pointer assets adapted from Pictogrammers Material Design Icons:
// cursor-default.svg, cursor-pointer.svg, and cursor-text.svg.
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
const VIDEO_MODE_TEXT_POINTER_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAFGklEQVR4nOxbS0scWRT+Wk3PTDIOzEJm48LxgathZJwHoszoZsBNEERBFDdCIBBXLsSliIu48Se4EcFlNro0voKBCHkICcFHC+4kkMTEmLajuafqnsqt6mr7VnnLB1UfHOrR99y696tzH1R/pwQxRwlijjJEh1SBcxWn0PMv5HOWvxZSMA+qs0XYDXntjbJ3wp7K81PP8XdhPyv1qDgW9kiWPfX4hibCdARQo18Lq9UoOy3svvQZEdaj4fNS2J/CTjxGCEWCyQiguv4Q9iSAz3t5/EnfBf8Jey4spxiRECoSTEZASq2vvLwcjY2NeYU2Nzext7fHl66OV1ZWorY2P3jW19dxcHDgVC3sprDP8pneIREIpgjgSHLGe0VFBRYWFnwLT09PY2RkxCGCOj4xMYGeHv9RUFNToxJwSxo9izr9BVcoArSGVF9fH7LZLAYGBqzrsbGxgp33wY+wCaDOqsOA2xCIhMgI2N/fR1tbm6tAVVWVda+/vx/d3d04OjpCOp1GV1eX9fvU1BQWFxexu7vr8qO6FKSFfS8sC3ulKZEWuPPcaBOgekqF/QV7qToTzc3NWFlZcd1ramrC2toaNHAP9iT4ThqNjU+wCeGhoA3TO8Fnwj4WK7S6uorx8XHnenR0VLfz1NEMAgy3YohiJ/ibsL/xbbb+AXbYUrj+L+wfKrS8vOw4LC0tqf6PhT2EPbmpMzyN80153zvxXYmNEDWCGvUW9jAgAnjC+g42AR8gCdjZ2XEcM5mMWs883B3lzhIBtBs8gr0EZuHeA4SC6QjgZYkaRw0tlfd4wvrABXO5XKE6yJ87m5XHnOfeIWwSjpEfKYFgigB+OL8paiSv03Sels8qOj/IOvhN05hX3/axtM/yd7rPERIKUQwBaigvSXR+Qz4nDAGHcL9tNRKOlXuXvhNk8BAgMBnU+FLoE0D+/JY/SR/1bXst9C4QMB8BDG4YHSkaaDgQCVnNepgEKs9EMAEcaae4YqsAgRvD6/SJ5zynWc8J3DM/H71v+1ydJ0T1RUhtWEoxncaqnWMi/N68EVzEN8Ewn7D8OnnucPdDlN8EVRhttEnE/qtwQgBijoQAxBwJAYg5EgIQcyQEIOZICEDMkRCAmCMhADFHQgBijoQAxBwJAYg5EgIQcyRyeVwMolClG8FF5Auo/w47zysrKzvLr5Cx7Eb9B/lciIKAQvkCpBS7w4Xq6uoch/r6emxvb/Nlh6yDBJAkqmKJDIkkSF2p/k2uiqVDIYp8AdL01xcr2NnZ6Zx3dHRgfn6eL5ul+eGVMJKgX+98gdbW1jwleUtLi6Ug1cC/wl7guuYLNDQ0YHJy0jqfm5tDKpVCe3u7pR0eHBzExsZGno8nX4ByDIzlC5gUS5ORCtQSS1dXV2Nra6ugw8zMDHp7e63z2dlZSz1eCJQvoMwRpKtfhz0n0PxACjIWTAbWC5rcB2gLmClhYnh42LkeGhqy7mmCtMckvyXJPAsw1RUnEEzL5SkCLB28ZsqMC5opM3dhZ51RvtGBNI6CwLrhS8kXUHAojzcD+BjNFzC9DHK+wC2NsovCHsAm7zbsbLBiMJ4vYDoCaEz+Av98gVJZjt56Bv66v1/xLSGK62XQJEcy+jewN0g0BNQIuPQhQI2m3R91mPIEvPkC6mSlqstVErgePqqTNCtHabxTlPH4Zy1xqNyBi8wX4Ajgcn67OQLripkI1YfF1yyjvzb5ApzddRYBagQwCV4CVCW5kXyBrwAAAP//qVxqLgAAAAZJREFUAwCpkwfomMTHxQAAAABJRU5ErkJggg==";
const VIDEO_MODE_TEXT_POINTER_SOURCE_SIZE = 64;
const VIDEO_MODE_TEXT_POINTER_SIZE = 28;
const VIDEO_MODE_TEXT_POINTER_HOTSPOT = { x: 32, y: 32 };

export type VideoModeSpan = {
  start: number;
  end: number;
};

export type VideoModeCaption = VideoModeSpan & {
  text: string;
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
  dialog?: VideoModeDialogAnnotation;
  image?: string;
  liveAction?: boolean;
  method?: OverrideableMethod;
  rect: VideoModeRect;
  thickness: number;
  viewport: VideoModeViewport;
};

export type VideoModeDialogAnnotation = {
  action: "accept" | "dismiss";
  message: string;
  promptText?: string;
  type: "alert" | "confirm" | "prompt";
};

export type VideoModeMetadata = {
  schemaVersion: 1;
  timebase: "ms";
  captions: VideoModeCaption[];
  deadAir: VideoModeSpan[];
  highlights: VideoModeHighlight[];
  outputs: VideoModeOutputs;
  sourceRange: VideoModeSourceRange;
};

export type VideoModeControls = {
  /** Run an action and show its title as a caption in the rendered video. */
  caption<T>(text: string, action: () => Promise<T>): Promise<T>;
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
   * Caption source. `"test-step"` records Playwright `test.step` spans;
   * `"explicit"` records only `videoMode.caption()` spans. Default: `"test-step"`
   */
  captions?: "explicit" | "test-step";
  /**
   * Render action annotations. `true` uses pointer mode with default options.
   * Default: true
   */
  highlight?: VideoModeHighlightOptions;
  /** Final hold duration in the rendered video (ms). Default: 3000 */
  finalHold?: number;
  /**
   * Type non-empty `fill()` values of at most 100 characters sequentially so
   * text entry is visible in the recording. Default: true
   */
  typeFills?: boolean;
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
  /**
   * Where the rendered video starts, trimming the blank "startup" lead-in
   * (about:blank, the loading shell, the pre-hydration app frame) so it opens on
   * real content instead of a white screen. An explicit `setStartTime()` always
   * wins over this.
   *
   * - `"auto"` (default): pick a sensible strategy — currently the blank
   *   detector below. Chosen so consumers get lead-in trimming just by upgrading.
   * - `"detect-blank"`: find where the leading blank frames end in the recorded
   *   pixels (the first frame that differs from the opening frame) and start
   *   there, when that lead-in is long enough to be worth trimming.
   * - `["selector", css]`: start the moment `css` first becomes visible (waited
   *   for live, once); falls back to blank detection if it never appears.
   * - `"never"`: don't trim. Use this for a video whose exact frames you assert
   *   on, since trimming shifts the timeline.
   */
  trimStart?: VideoModeTrimStart;
};

export type VideoModeTrimStart = "auto" | "detect-blank" | "never" | ["selector", string];

const TYPED_FILL_DELAY_MS = 50;
const TYPED_FILL_MAX_LENGTH = 100;

type FillOptions = NonNullable<Parameters<Locator["fill"]>[1]>;
type TypeOptions = NonNullable<Parameters<Locator["type"]>[1]>;

const typedFillAction = async (
  locator: LocatorWithOriginal,
  args: unknown[],
): Promise<{ args: unknown[]; method: "type" } | undefined> => {
  const value = args[0];
  const fillOptions = args[1] as FillOptions | undefined;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > TYPED_FILL_MAX_LENGTH ||
    fillOptions?.force
  ) {
    return;
  }

  await locator.fill_original("", fillOptions);
  const typeOptions: TypeOptions = { delay: TYPED_FILL_DELAY_MS };
  if (fillOptions?.noWaitAfter !== undefined) {
    typeOptions.noWaitAfter = fillOptions.noWaitAfter;
  }
  if (fillOptions?.timeout !== undefined) {
    typeOptions.timeout = fillOptions.timeout;
  }
  return { args: [value, typeOptions], method: "type" };
};

type VideoModeState = {
  captions: VideoModeCaption[];
  deadAirDepth: number;
  deadAirSpans: VideoModeSpan[];
  highlights: VideoModeHighlight[];
  highlightImageIndex: number;
  lastDialogEndedAt?: number;
  outputs: VideoModeOutputs;
  sourceRange: VideoModeSourceRange;
  startedAt?: number;
};

type VideoModeDialogOverlaySnapshot = {
  buttonRect: VideoModeRect;
  inputRect?: VideoModeRect;
  viewport: VideoModeViewport;
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
  method?: OverrideableMethod;
  outputEnd: number;
  outputStart: number;
  point: { x: number; y: number };
};

type PlannedCursorTarget = CursorTarget & {
  arriveAt: number;
};

type CursorPlan = {
  targets: PlannedCursorTarget[];
  waypoints: CursorWaypoint[];
};

const CURSOR_MOVEMENT_MIN_MS = 200;
const CURSOR_MOVEMENT_MAX_MS = 1000;
const CURSOR_MOVEMENT_MIN_IDEAL_MS = 300;
const CURSOR_MOVEMENT_MAX_IDEAL_MS = 700;
const CURSOR_MOVEMENT_SPEED_PX_PER_SECOND = 600;
const CURSOR_REST_BEFORE_ACTION_MS = 200;
const CURSOR_TARGET_HOLD_IDEAL_MS = 1000;
const TEXT_CURSOR_HOLD_IDEAL_MS = 800;
const TEXT_CURSOR_POINTER_TAIL_MS = 200;
const DIALOG_POST_ROLL_MS = 1000;

type HighlightInput = {
  durationMs: number;
  image: string;
  inputIndex: number;
  path: string;
};

type DialogPostFrameInput = {
  inputIndex: number;
  path: string;
  viewport: VideoModeViewport;
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

type ResolvedTrimStart = {
  selector?: string;
  detectBlank: boolean;
};

// A `selector` falls back to blank detection if it never shows, so a bad
// selector can't leave the video opening on the blank lead-in.
const TRIM_START_SELECTOR_TIMEOUT_MS = 30_000;
// Only trim when the detected blank lead-in is at least this long, so a video
// that was never really blank isn't nudged.
const TRIM_START_MIN_LEAD_IN_MS = 1000;

const resolveTrimStart = (trimStart: VideoModeOptions["trimStart"]): ResolvedTrimStart => {
  const value = trimStart === undefined ? "auto" : trimStart;

  if (Array.isArray(value)) {
    const [kind, selector] = value;
    if (kind !== "selector" || typeof selector !== "string" || selector.length === 0) {
      throw new Error('videoMode trimStart tuple must be ["selector", "<css>"]');
    }
    return { selector, detectBlank: true };
  }

  switch (value) {
    case "never":
      return { detectBlank: false };
    case "auto":
    case "detect-blank":
      return { detectBlank: true };
    default:
      throw new Error(
        'videoMode trimStart must be "auto", "detect-blank", "never", or ["selector", "<css>"]',
      );
  }
};

// Blank-lead-in detection tuning. The recorded startup is a run of *identical*
// frames — the browser paints nothing new (about:blank, then a static loading
// shell) until content arrives. So the signal isn't how "busy" a frame is (a
// letterbox bar or a solid-but-dark shell would fool that); it's the first frame
// that *differs* from the opening frame. We decode a coarse, tiny greyscale strip
// of the opening seconds and find where it first changes and stays changed.
const AUTO_START_SAMPLE_FPS = 5;
const AUTO_START_SAMPLE_SIZE = 48;
const AUTO_START_MAX_SCAN_MS = 30_000;
// Mean per-pixel greyscale delta (0-255) above which a frame counts as "changed"
// from the opening frame. Comfortably above VP8 quantisation noise on a static
// scene (which stays ~0) and below the jump when real content paints.
const AUTO_START_DIFF_THRESHOLD = 1.5;

const frameMeanAbsDiff = (frame: Buffer, reference: Buffer) => {
  let sum = 0;
  for (let index = 0; index < frame.length; index += 1) {
    sum += Math.abs(frame[index] - reference[index]);
  }
  return sum / frame.length;
};

/**
 * Return the timestamp (ms) where the leading blank frames end and the screen
 * first changes (content paints), or undefined when the video never opens with a
 * static lead-in (nothing to trim).
 */
const detectBlankLeadInEndMs = async (inputPath: string): Promise<number | undefined> => {
  const size = AUTO_START_SAMPLE_SIZE;
  const frameSize = size * size;
  let stdout: Buffer;
  try {
    const result = await execFile(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        inputPath,
        "-vf",
        `fps=${AUTO_START_SAMPLE_FPS},scale=${size}:${size},format=gray`,
        "-t",
        formatSeconds(AUTO_START_MAX_SCAN_MS),
        "-f",
        "rawvideo",
        "-pix_fmt",
        "gray",
        "pipe:1",
      ],
      { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
    );
    stdout = result.stdout as Buffer;
  } catch {
    // Detection is best-effort; a decode failure just means "don't trim".
    return undefined;
  }

  const frameCount = Math.floor(stdout.length / frameSize);
  if (frameCount < 2) {
    return undefined;
  }

  const firstFrame = stdout.subarray(0, frameSize);
  const hasChanged = (index: number) =>
    frameMeanAbsDiff(
      stdout.subarray(index * frameSize, (index + 1) * frameSize),
      firstFrame,
    ) > AUTO_START_DIFF_THRESHOLD;

  // First frame that differs from the opening frame *and* stays changed (two
  // consecutive samples), so a single decode blip can't trip it.
  for (let index = 1; index < frameCount - 1; index += 1) {
    if (hasChanged(index) && hasChanged(index + 1)) {
      return Math.round((index / AUTO_START_SAMPLE_FPS) * 1000);
    }
  }

  return undefined;
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
    captions: normalizeVideoCaptions(state.captions),
    deadAir: mergeVideoSpans(state.deadAirSpans),
    highlights: normalizeVideoHighlights(state.highlights),
    outputs: state.outputs,
    schemaVersion: 1,
    sourceRange: normalizeSourceRange(state.sourceRange),
    timebase: "ms",
  };
};

const normalizeVideoCaptions = (captions: VideoModeCaption[]) => {
  const valid = captions.filter((caption) => caption.end > caption.start);
  const boundaries = [...new Set(valid.flatMap((caption) => [caption.start, caption.end]))].sort(
    (left, right) => left - right,
  );
  const normalized: VideoModeCaption[] = [];

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    const caption = valid
      .filter((candidate) => candidate.start <= start && candidate.end >= end)
      .sort((left, right) => right.start - left.start || left.end - right.end)[0];

    if (!caption || end <= start) {
      continue;
    }

    const previous = normalized[normalized.length - 1];
    if (previous && previous.text === caption.text && previous.end === start) {
      previous.end = end;
    } else {
      normalized.push({ end, start, text: caption.text });
    }
  }

  return normalized;
};

type PlaywrightStepData = {
  category?: string;
  title: string;
};

type PlaywrightInternalStep = {
  complete(result: unknown): void;
};

type PlaywrightTestInfo = TestInfo & {
  _addStep?: (
    data: PlaywrightStepData,
    parentStep?: PlaywrightInternalStep,
  ) => PlaywrightInternalStep;
};

const observePlaywrightStepCaptions = (
  testInfo: TestInfo,
  state: VideoModeState,
  getVideoTimestamp: () => number,
) => {
  const playwrightTestInfo = testInfo as PlaywrightTestInfo;
  const originalAddStep = playwrightTestInfo._addStep;

  if (!originalAddStep) {
    return () => {};
  }

  const activeSteps = new Map<PlaywrightInternalStep, VideoModeCaption>();
  const finishStep = (step: PlaywrightInternalStep) => {
    const caption = activeSteps.get(step);

    if (!caption) {
      return;
    }

    activeSteps.delete(step);
    state.captions.push({
      ...caption,
      end: Math.max(caption.start + 1, getVideoTimestamp()),
    });
  };
  const addStep = (
    data: PlaywrightStepData,
    parentStep?: PlaywrightInternalStep,
  ): PlaywrightInternalStep => {
    const step = originalAddStep.call(playwrightTestInfo, data, parentStep);

    if (data.category === "test.step") {
      activeSteps.set(step, {
        end: 0,
        start: getVideoTimestamp(),
        text: data.title,
      });
      const originalComplete = step.complete;
      step.complete = (result) => {
        finishStep(step);
        originalComplete.call(step, result);
      };
    }

    return step;
  };

  playwrightTestInfo._addStep = addStep;

  return () => {
    for (const step of activeSteps.keys()) {
      finishStep(step);
    }
    if (playwrightTestInfo._addStep === addStep) {
      playwrightTestInfo._addStep = originalAddStep;
    }
  };
};

const recordCaption = async <T>(
  state: VideoModeState,
  getVideoTimestamp: () => number,
  text: string,
  action: () => Promise<T>,
) => {
  const start = getVideoTimestamp();

  try {
    return await action();
  } finally {
    state.captions.push({
      end: Math.max(start + 1, getVideoTimestamp()),
      start,
      text,
    });
  }
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

const installVideoModeDialogOverlay = () => {
  const videoWindow = window as Window & {
    __middlewrightVideoModeDialogsInstalled?: boolean;
  };

  if (videoWindow.__middlewrightVideoModeDialogsInstalled) {
    return;
  }

  videoWindow.__middlewrightVideoModeDialogsInstalled = true;
  const originalAlert = window.alert.bind(window);
  const originalConfirm = window.confirm.bind(window);
  const originalPrompt = window.prompt.bind(window);

  const messageText = (message: unknown, argumentCount: number) => {
    return argumentCount === 0 ? "" : String(message);
  };

  const showOverlay = (
    type: "alert" | "confirm" | "prompt",
    message: string,
    defaultValue: string,
  ) => {
    const host = document.createElement("div");
    host.setAttribute("data-middlewright-video-mode-dialog", "");
    host.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:2147483647",
      "display:grid",
      "place-items:center",
      "background:rgba(15,23,42,.42)",
      "pointer-events:none",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    ].join(";");

    const panel = document.createElement("section");
    panel.setAttribute("role", "dialog");
    panel.style.cssText = [
      "box-sizing:border-box",
      "width:min(480px,calc(100vw - 48px))",
      "border:1px solid #d1d5db",
      "border-radius:12px",
      "background:#fff",
      "box-shadow:0 24px 70px rgba(0,0,0,.32)",
      "color:#111827",
      "padding:24px",
    ].join(";");

    const title = document.createElement("strong");
    title.textContent = type === "alert" ? "Alert" : type === "confirm" ? "Confirm" : "Prompt";
    title.style.cssText = "display:block;font-size:17px;line-height:24px;margin:0 0 10px";
    panel.append(title);

    const copy = document.createElement("div");
    copy.setAttribute("data-dialog-message", "");
    copy.textContent = message;
    copy.style.cssText = "font-size:15px;line-height:22px;overflow-wrap:anywhere;white-space:pre-wrap";
    panel.append(copy);

    if (type === "prompt") {
      const input = document.createElement("input");
      input.setAttribute("data-dialog-input", "");
      input.value = defaultValue;
      input.style.cssText = [
        "box-sizing:border-box",
        "width:100%",
        "height:38px",
        "margin-top:18px",
        "border:1px solid #9ca3af",
        "border-radius:7px",
        "background:#fff",
        "color:#111827",
        "font:15px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        "padding:7px 10px",
      ].join(";");
      panel.append(input);
    }

    const actions = document.createElement("footer");
    actions.style.cssText = "display:flex;justify-content:flex-end;gap:10px;margin-top:22px";
    const button = (action: "accept" | "dismiss", label: string) => {
      const element = document.createElement("button");
      element.setAttribute("data-dialog-action", action);
      element.textContent = label;
      element.style.cssText = [
        "box-sizing:border-box",
        "min-width:78px",
        "height:36px",
        "border:1px solid #9ca3af",
        "border-radius:7px",
        "background:#fff",
        "color:#111827",
        "font:600 14px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        "padding:7px 14px",
      ].join(";");
      actions.append(element);
      return element;
    };

    if (type !== "alert") {
      button("dismiss", "Cancel");
    }
    button("accept", "OK");
    panel.append(actions);
    host.append(panel);
    document.documentElement.append(host);

    return {
      complete: (action: "accept" | "dismiss", promptText?: string) => {
        host.setAttribute("data-dialog-resolved", "");
        host.setAttribute("data-dialog-result", action);
        if (promptText !== undefined) {
          const input = host.querySelector<HTMLInputElement>("[data-dialog-input]");
          if (input) input.value = promptText;
        }
        const selected = host.querySelector<HTMLButtonElement>(`[data-dialog-action="${action}"]`);
        if (selected) {
          selected.style.background = "#2563eb";
          selected.style.borderColor = "#2563eb";
          selected.style.color = "#fff";
        }
      },
    };
  };

  window.alert = function (message?: unknown) {
    const overlay = showOverlay("alert", messageText(message, arguments.length), "");
    const result = originalAlert(messageText(message, arguments.length));
    overlay.complete("accept");
    return result;
  };

  window.confirm = function (message?: string) {
    const text = messageText(message, arguments.length);
    const overlay = showOverlay("confirm", text, "");
    const result = originalConfirm(text);
    overlay.complete(result ? "accept" : "dismiss");
    return result;
  };

  window.prompt = function (message?: string, defaultValue?: string) {
    const text = messageText(message, arguments.length);
    const initialValue = arguments.length < 2 ? "" : String(defaultValue);
    const overlay = showOverlay("prompt", text, initialValue);
    const result = originalPrompt(text, initialValue);
    overlay.complete(result === null ? "dismiss" : "accept", result === null ? undefined : result);
    return result;
  };
};

const videoModeDialogOverlaySnapshot = async (
  host: Locator,
  action: "accept" | "dismiss",
): Promise<VideoModeDialogOverlaySnapshot> => {
  return await host.evaluate((host, selectedAction) => {
    const rectFor = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return {
        height: rect.height,
        width: rect.width,
        x: rect.left,
        y: rect.top,
      };
    };
    const selected = host.querySelector(`[data-dialog-action="${selectedAction}"]`);
    const input = host.querySelector("[data-dialog-input]");

    if (!selected) {
      throw new Error(`videoMode dialog overlay has no ${selectedAction} button`);
    }

    return {
      buttonRect: rectFor(selected),
      inputRect: input ? rectFor(input) : undefined,
      viewport: {
        height: window.innerHeight,
        width: window.innerWidth,
      },
    };
  }, action);
};

const isolateNextVideoModeDialogOverlay = async (page: Page) => {
  const host = page.locator(`[${VIDEO_MODE_DIALOG_ATTRIBUTE}][data-dialog-resolved]`).first();
  await host.waitFor({ state: "attached", timeout: 1000 });
  await host.evaluate((selected, attribute) => {
    for (const candidate of document.querySelectorAll<HTMLElement>(`[${attribute}]`)) {
      candidate.style.display = candidate === selected ? "grid" : "none";
    }
  }, VIDEO_MODE_DIALOG_ATTRIBUTE);
  return host;
};

const removeVideoModeDialogOverlay = async (page: Page, host: Locator) => {
  await host.evaluate((element) => element.remove()).catch(() => {});
  await page
    .locator(`[${VIDEO_MODE_DIALOG_ATTRIBUTE}]`)
    .evaluateAll((hosts) => hosts.forEach((candidate) => candidate.style.removeProperty("display")))
    .catch(() => {});
};

const setVideoModeDialogOverlayState = async (
  host: Locator,
  options: { action?: "accept" | "dismiss"; promptText?: string },
) => {
  await host.evaluate((host, state) => {
    const input = host.querySelector<HTMLInputElement>("[data-dialog-input]");
    if (input && state.promptText !== undefined) {
      input.value = state.promptText;
    }

    for (const button of host.querySelectorAll<HTMLButtonElement>("[data-dialog-action]")) {
      button.style.background = "#fff";
      button.style.borderColor = "#9ca3af";
      button.style.color = "#111827";
    }

    if (state.action) {
      const selected = host.querySelector<HTMLButtonElement>(
        `[data-dialog-action="${state.action}"]`,
      );
      if (selected) {
        selected.style.background = "#2563eb";
        selected.style.borderColor = "#2563eb";
        selected.style.color = "#fff";
      }
    }
  }, options);
};

const recordDialogHighlights = async (options: {
  action: "accept" | "dismiss";
  color: string;
  dialog: Dialog;
  durationMs: number;
  page: Page;
  promptText?: string;
  state: VideoModeState;
  testInfo: TestInfo;
  thickness: number;
}) => {
  const action = options.dialog.type() === "alert" ? "accept" : options.action;
  const host = await isolateNextVideoModeDialogOverlay(options.page);
  if (options.state.startedAt === undefined || options.durationMs <= 0) {
    await removeVideoModeDialogOverlay(options.page, host);
    return;
  }

  try {
    const snapshot = await videoModeDialogOverlaySnapshot(host, action);
    await mkdir(options.testInfo.outputDir, { recursive: true });
    const dialog: VideoModeDialogAnnotation = {
      action,
      message: options.dialog.message(),
      ...(options.promptText === undefined ? {} : { promptText: options.promptText }),
      type: options.dialog.type() as VideoModeDialogAnnotation["type"],
    };
    const record = async (method: OverrideableMethod, rect: VideoModeRect) => {
      const image = `video-mode-highlight-${options.state.highlightImageIndex}.png`;
      options.state.highlightImageIndex += 1;
      await options.page.screenshot({
        path: join(options.testInfo.outputDir, image),
        scale: "css",
      });
      const start = Math.round(performance.now() - options.state.startedAt!);
      options.state.highlights.push({
        actionEnd: start,
        color: options.color,
        dialog,
        end: start + Math.round(options.durationMs),
        image,
        method,
        rect,
        start,
        thickness: options.thickness,
        viewport: snapshot.viewport,
      });
    };

    if (
      dialog.type === "prompt" &&
      action === "accept" &&
      options.promptText !== undefined &&
      snapshot.inputRect
    ) {
      await setVideoModeDialogOverlayState(host, {
        promptText: options.dialog.defaultValue(),
      });
      await record("fill", snapshot.inputRect);
    }

    await setVideoModeDialogOverlayState(host, {
      action,
      promptText: options.promptText,
    });
    await record("click", snapshot.buttonRect);
  } finally {
    await removeVideoModeDialogOverlay(options.page, host);
    if (options.state.startedAt !== undefined) {
      options.state.lastDialogEndedAt = Math.round(
        performance.now() - options.state.startedAt,
      );
    }
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

const formatAssTime = (ms: number) => {
  const centiseconds = Math.max(0, Math.round(ms / 10));
  const hours = Math.floor(centiseconds / 360_000);
  const minutes = Math.floor((centiseconds % 360_000) / 6_000);
  const seconds = Math.floor((centiseconds % 6_000) / 100);
  const remainder = centiseconds % 100;

  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(
    remainder,
  ).padStart(2, "0")}`;
};

const escapeAssText = (text: string) => {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\r?\n/g, "\\N");
};

const assCaptions = (
  captions: VideoModeCaption[],
  video: { height: number; width: number },
) => {
  const fontSize = Math.max(24, Math.round(video.height * 0.06));
  const margin = Math.max(24, Math.round(video.height * 0.06));
  const events = captions
    .map(
      (caption) =>
        `Dialogue: 0,${formatAssTime(caption.start)},${formatAssTime(caption.end)},Caption,,0,0,0,,${escapeAssText(caption.text)}`,
    )
    .join("\n");

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${video.width}`,
    `PlayResY: ${video.height}`,
    "ScaledBorderAndShadow: yes",
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Caption,Arial,${fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&HA0000000,0,0,0,0,100,100,0,0,3,1,0,2,${margin},${margin},${margin},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    events,
    "",
  ].join("\n");
};

const escapeFfmpegFilterValue = (value: string) => {
  return value.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/,/g, "\\,");
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

const recordActionElapsedDeadAirFromTiming = (
  state: VideoModeState,
  timing: Pick<ActionTiming, "actionStartedAt">,
  options: { minimumMs: number },
) => {
  if (state.startedAt === undefined) {
    return;
  }

  const start = Math.round(timing.actionStartedAt - state.startedAt);
  const end = Math.round(performance.now() - state.startedAt);

  if (end - start < options.minimumMs) {
    return;
  }

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

  for (const segment of options.segments) {
    let cursor = segment.start;
    const highlights = options.highlights.filter(
      (highlight) => highlight.start >= segment.start && highlight.start < segment.end,
    );

    for (let index = 0; index < highlights.length; index += 1) {
      const highlight = highlights[index];
      const nextHighlight = highlights[index + 1];

      if (highlight.start > cursor) {
        pieces.push({ end: highlight.start, speed: segment.speed, start: cursor });
      }

      let frameStart = Math.max(
        segment.start,
        highlight.start - VIDEO_MODE_HIGHLIGHT_FRAME_MS,
      );
      let frameEnd = highlight.start;

      if (frameEnd <= frameStart) {
        frameStart = highlight.start;
        frameEnd = Math.min(segment.end, frameStart + VIDEO_MODE_HIGHLIGHT_FRAME_MS);
      }

      if (highlight.liveAction) {
        const liveEnd = highlight.actionEnd || frameEnd;
        frameEnd = Math.min(segment.end, Math.max(frameEnd, liveEnd));
      }

      if (frameEnd > frameStart) {
        pieces.push({ end: frameEnd, highlight, speed: segment.speed, start: frameStart });
      }

      let nextCursor = Math.max(highlight.start, highlight.actionEnd || highlight.start);

      if (nextHighlight && highlight.end > nextHighlight.start) {
        nextCursor = Math.max(nextCursor, nextHighlight.start);
      }

      cursor = Math.min(segment.end, nextCursor);
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

  if (piece.highlight.image && !piece.highlight.liveAction) {
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

const projectVideoCaptions = (
  captions: VideoModeCaption[],
  pieces: RenderedVideoPiece[],
) => {
  const projected = captions.flatMap((caption) => {
    return pieces.flatMap((piece) => {
      const overlap = clipVideoSpan(caption, piece);

      if (!overlap || !Number.isFinite(piece.speed)) {
        return [];
      }

      const start = piece.outputStart + (overlap.start - piece.start) / piece.speed;
      const mappedEnd = piece.outputStart + (overlap.end - piece.start) / piece.speed;
      const end =
        piece.highlight &&
        caption.start <= piece.highlight.start &&
        caption.end >= piece.highlight.start
          ? piece.outputEnd
          : mappedEnd;

      return [
        {
          end: Math.round(end),
          start: Math.round(start),
          text: caption.text,
        },
      ];
    });
  });

  return normalizeVideoCaptions(projected);
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
      method: highlight.method,
      outputEnd: piece.outputEnd,
      outputStart: piece.outputStart,
      point: highlightCursorPoint(highlight, options.video),
    });
  }

  return targets;
};

const cursorMovementIdealDuration = (options: {
  currentPoint: { x: number; y: number };
  target: CursorTarget;
}) => {
  const distance = Math.hypot(
    options.target.point.x - options.currentPoint.x,
    options.target.point.y - options.currentPoint.y,
  );
  const duration = (distance / CURSOR_MOVEMENT_SPEED_PX_PER_SECOND) * 1000;

  return Math.max(
    CURSOR_MOVEMENT_MIN_IDEAL_MS,
    Math.min(CURSOR_MOVEMENT_MAX_IDEAL_MS, duration),
  );
};

const cursorArrivalDeadline = (options: {
  currentPoint: { x: number; y: number };
  earliestStart: number;
  target: CursorTarget;
}) => {
  const target = options.target;
  const latestArrivalWithMinimumRest = Math.max(
    target.outputStart,
    target.outputEnd - CURSOR_REST_BEFORE_ACTION_MS,
  );
  const idealHoldArrival = Math.max(
    target.outputStart,
    target.outputEnd - CURSOR_TARGET_HOLD_IDEAL_MS,
  );
  const readableMovementArrival =
    options.earliestStart + cursorMovementIdealDuration(options);

  return Math.min(
    latestArrivalWithMinimumRest,
    Math.max(idealHoldArrival, readableMovementArrival),
  );
};

const cursorMovementTiming = (options: {
  currentPoint: { x: number; y: number };
  earliestStart: number;
  target: CursorTarget;
}) => {
  const deadline = cursorArrivalDeadline(options);
  const available = Math.max(0, deadline - options.earliestStart);
  const idealDuration = Math.min(cursorMovementIdealDuration(options), CURSOR_MOVEMENT_MAX_MS);
  const duration =
    available < CURSOR_MOVEMENT_MIN_MS ? available : Math.min(idealDuration, available);
  const startAt = Math.max(options.earliestStart, deadline - duration);

  return {
    arriveAt: startAt + duration,
    startAt,
  };
};

/**
 * Plan cursor motion backwards from each action's click/commit moment.
 *
 * The cursor starts in the center and switches to a target-specific shape only
 * after arriving. Movement aims for a readable distance-based speed, clamped to
 * a short 300-700ms range, while still compressing toward 200ms when the
 * existing video timeline has no room. The arrival point preserves an ideal 1s
 * target hold when possible and otherwise gives the hand/text cursor most of
 * the configured highlight hold without extending product interaction time.
 */
const cursorPlan = (
  targets: CursorTarget[],
  video: { width: number; height: number },
): CursorPlan => {
  const waypoints: CursorWaypoint[] = [];
  const plannedTargets: PlannedCursorTarget[] = [];
  let currentPoint = {
    x: video.width / 2,
    y: video.height / 2,
  };
  let earliestStart = 0;

  if (targets.length === 0) {
    return { targets: plannedTargets, waypoints };
  }

  pushCursorWaypoint(waypoints, {
    at: 0,
    x: currentPoint.x,
    y: currentPoint.y,
  });

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const nextTarget = targets[index + 1];
    const movement = cursorMovementTiming({ currentPoint, earliestStart, target });
    const holdEnd = nextTarget
      ? Math.min(target.outputEnd, nextTarget.outputStart)
      : target.outputEnd;

    pushCursorWaypoint(waypoints, {
      at: movement.startAt,
      x: currentPoint.x,
      y: currentPoint.y,
    });
    pushCursorWaypoint(waypoints, {
      at: movement.arriveAt,
      x: target.point.x,
      y: target.point.y,
    });
    pushCursorWaypoint(waypoints, {
      at: Math.max(holdEnd, movement.arriveAt),
      x: target.point.x,
      y: target.point.y,
    });
    plannedTargets.push({
      ...target,
      arriveAt: movement.arriveAt,
    });

    currentPoint = target.point;
    earliestStart = Math.max(earliestStart, target.outputEnd);
  }

  return { targets: plannedTargets, waypoints };
};

const methodCursorSpans = (targets: PlannedCursorTarget[], methods: OverrideableMethod[]) => {
  return targets
    .filter((target) => target.method !== undefined && methods.includes(target.method))
    .map((target) => ({
      end: target.outputEnd,
      start: target.arriveAt,
    }))
    .filter((span) => span.end > span.start);
};

const textCursorSpans = (targets: PlannedCursorTarget[]) => {
  return targets
    .filter((target) => target.method === "fill" || target.method === "type")
    .map((target) => ({
      end: Math.min(
        target.arriveAt + TEXT_CURSOR_HOLD_IDEAL_MS,
        Math.max(target.arriveAt, target.outputEnd - TEXT_CURSOR_POINTER_TAIL_MS),
      ),
      start: target.arriveAt,
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

  const lastTarget = targets[targets.length - 1];
  const tailDuration = Math.max(0, lastTarget.outputEnd - lastTarget.outputStart);

  return {
    end: lastTarget.outputEnd + tailDuration,
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
  captionFile?: string;
  clickPointerInput?: PointerInput;
  cursorPointerInput?: PointerInput;
  dialogPostFrameInput: DialogPostFrameInput | undefined;
  dialogPostHoldMs: number;
  finalHoldMs: number;
  highlightMode: "outline" | "pointer";
  highlightInputs: HighlightInput[];
  highlights: VideoModeHighlight[];
  segments: RenderVideoSegment[];
  textPointerInput?: PointerInput;
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
  const plan = cursorPlan(targets, options.video);
  const clickSpans = methodCursorSpans(plan.targets, ["click"]);
  const textSpans = textCursorSpans(plan.targets);
  const activitySpan = cursorActivitySpan(targets, plan.waypoints);
  const clickSpanExpression = videoSpanExpression(clickSpans);
  const textSpanExpression = videoSpanExpression(textSpans);

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

    if (
      piece.highlight?.image &&
      piece.highlight.liveAction &&
      highlightInputByImage.has(piece.highlight.image)
    ) {
      // Keep the surrounding pre-action screenshot stable while replaying the
      // real typed pixels inside the field.
      const input = highlightInputByImage.get(piece.highlight.image)!;
      const scaledViewport = scaledViewportSize(piece.highlight.viewport, options.video);
      const rect = scaleHighlight(piece.highlight, options.video);
      const duration = renderedPieceDuration(piece);
      const sourceDuration = (piece.end - piece.start) / piece.speed;
      const baseLabel = `livebase${index}`;
      const cropLabel = `livecrop${index}`;
      filters.push(
        [
          `[${input.inputIndex}:v]scale=w=${scaledViewport.width}:h=${scaledViewport.height}`,
          `pad=w=${options.video.width}:h=${options.video.height}:x=0:y=0:color=gray`,
          `trim=start=0:end=${formatSeconds(duration)}`,
          `setpts=PTS-STARTPTS[${baseLabel}]`,
        ].join(","),
      );
      filters.push(
        [
          `[0:v]trim=start=${formatSeconds(piece.start)}:end=${formatSeconds(piece.end)}`,
          `setpts=(PTS-STARTPTS)/${formatFilterNumber(piece.speed)}`,
          `crop=w=${rect.width}:h=${rect.height}:x=${rect.x}:y=${rect.y}`,
          `tpad=stop_mode=clone:stop_duration=${formatSeconds(
            Math.max(0, duration - sourceDuration),
          )}[${cropLabel}]`,
        ].join(","),
      );
      operations.push(
        `[${baseLabel}][${cropLabel}]overlay=x=${rect.x}:y=${rect.y}:shortest=1`,
      );
      if (options.highlightMode === "outline") {
        operations.push(drawboxFilter(piece.highlight, options.video));
      }
      filters.push(`${operations.join(",")}[${label}]`);
      continue;
    }

    if (
      piece.highlight?.image &&
      !piece.highlight.liveAction &&
      highlightInputByImage.has(piece.highlight.image)
    ) {
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

    if (piece.highlight && (!piece.highlight.image || piece.highlight.liveAction)) {
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

  let concatLabel = labels.length === 1 ? labels[0].slice(1, -1) : "renderconcat";

  if (labels.length > 1) {
    filters.push(`${labels.join("")}concat=n=${labels.length}:v=1:a=0[${concatLabel}]`);
  }

  const dialogPostHoldMs = Math.max(0, Math.round(options.dialogPostHoldMs));
  const finalHoldMs = Math.max(0, Math.round(options.finalHoldMs));
  let remainingFinalHoldMs = Math.max(finalHoldMs, dialogPostHoldMs);

  if (dialogPostHoldMs > 0 && options.dialogPostFrameInput) {
    const scaledViewport = scaledViewportSize(
      options.dialogPostFrameInput.viewport,
      options.video,
    );
    const cleanPostHoldMs = Math.max(dialogPostHoldMs, finalHoldMs);
    filters.push(
      [
        `[${options.dialogPostFrameInput.inputIndex}:v]scale=w=${scaledViewport.width}:h=${scaledViewport.height}`,
        `pad=w=${options.video.width}:h=${options.video.height}:x=0:y=0:color=gray`,
        `trim=start=0:end=${formatSeconds(cleanPostHoldMs)}`,
        "setpts=PTS-STARTPTS[dialogpost]",
      ].join(","),
    );
    filters.push(`[${concatLabel}][dialogpost]concat=n=2:v=1:a=0[renderdialogpost]`);
    concatLabel = "renderdialogpost";
    remainingFinalHoldMs = 0;
  }

  const outputLabel = remainingFinalHoldMs > 0 ? "renderout" : concatLabel;

  if (remainingFinalHoldMs > 0) {
    filters.push(
      `[${concatLabel}]tpad=stop_mode=clone:stop_duration=${formatSeconds(remainingFinalHoldMs)}[${outputLabel}]`,
    );
  }

  let annotatedOutputLabel = outputLabel;

  if (
    options.highlightMode === "pointer" &&
    options.cursorPointerInput &&
    plan.waypoints.length > 0 &&
    activitySpan
  ) {
    const cursorOutputLabel = "renderpointer";
    const cursorActivityExpression = `between(t\\,${formatSeconds(activitySpan.start)}\\,${formatSeconds(activitySpan.end)})`;
    const specialCursorExpression = [clickSpanExpression, textSpanExpression]
      .filter(Boolean)
      .join("+");
    const cursorEnable = specialCursorExpression
      ? `${cursorActivityExpression}*not(${specialCursorExpression})`
      : cursorActivityExpression;
    filters.push(
      cursorOverlayFilters({
        enable: cursorEnable,
        inputLabel: outputLabel,
        outputLabel: cursorOutputLabel,
        pointerInput: options.cursorPointerInput,
        waypoints: plan.waypoints,
      }),
    );

    let pointerOutputLabel = cursorOutputLabel;

    if (options.textPointerInput && textSpanExpression) {
      const textPointerOutputLabel = "rendertextpointer";
      filters.push(
        cursorOverlayFilters({
          enable: textSpanExpression,
          inputLabel: pointerOutputLabel,
          outputLabel: textPointerOutputLabel,
          pointerInput: options.textPointerInput,
          waypoints: plan.waypoints,
        }),
      );
      pointerOutputLabel = textPointerOutputLabel;
    }

    if (options.clickPointerInput && clickSpanExpression) {
      const clickPointerOutputLabel = "renderclickpointer";
      filters.push(
        cursorOverlayFilters({
          enable: clickSpanExpression,
          inputLabel: pointerOutputLabel,
          outputLabel: clickPointerOutputLabel,
          pointerInput: options.clickPointerInput,
          waypoints: plan.waypoints,
        }),
      );

      pointerOutputLabel = clickPointerOutputLabel;
    }

    annotatedOutputLabel = pointerOutputLabel;
  }

  if (options.captionFile) {
    filters.push(
      `[${annotatedOutputLabel}]ass=${escapeFfmpegFilterValue(options.captionFile)}[rendercaptions]`,
    );
    annotatedOutputLabel = "rendercaptions";
  }

  return {
    outputLabel: annotatedOutputLabel,
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

const videoElementHtml = (options: {
  activeKey: "raw" | "rendered";
  label: string;
  source: string;
}) => {
  const activeKey = escapeHtml(options.activeKey);
  const label = escapeHtml(options.label);
  const source = escapeHtml(options.source);

  return `
      <section class="video-section" data-active-key="${activeKey}">
        <div class="section-title">${label}</div>
        <video controls preload="metadata" tabindex="0" data-active-key="${activeKey}">
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
  const primaryActiveKey = options.rendered ? "rendered" : "raw";
  const rawDetails = options.rendered
    ? `
      <details>
        <summary>Raw video</summary>
        ${videoElementHtml({ activeKey: "raw", label: "Raw video", source: options.raw })}
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
      ${videoElementHtml({ activeKey: primaryActiveKey, label: primaryLabel, source: primary })}
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
    const videoByActiveKey = new Map(videos.map((video) => [video.dataset.activeKey, video]));
    let activeVideo = videos[0];

    const rate = () => Number(fps.value) || 25;
    const currentFrame = () => Math.round(activeVideo.currentTime * rate());
    const activeKeyFor = (video) => video.dataset.activeKey || "rendered";
    const revealVideo = (video) => {
      const details = video.closest("details");
      if (details) details.open = true;
    };
    const writeStateToUrl = () => {
      const next = new URL(location.href);
      next.searchParams.set("active", activeKeyFor(activeVideo));
      next.searchParams.set("frame", String(currentFrame()));
      history.replaceState(null, "", next.href);
    };

    const setActiveVideo = (video, writeUrl) => {
      activeVideo = video;
      revealVideo(video);
      update(writeUrl);
    };

    const update = (writeUrl) => {
      const title = activeVideo.closest(".video-section").querySelector(".section-title").textContent;
      active.textContent = title;
      time.textContent = activeVideo.currentTime.toFixed(3);
      frame.textContent = String(currentFrame());
      duration.textContent = Number.isFinite(activeVideo.duration) ? activeVideo.duration.toFixed(3) : "?";
      if (writeUrl) writeStateToUrl();
    };

    const seekToFrame = (frameNumber, writeUrl) => {
      if (!Number.isFinite(frameNumber)) return;
      if (!Number.isFinite(activeVideo.duration)) {
        activeVideo.addEventListener("loadedmetadata", () => seekToFrame(frameNumber, writeUrl), {
          once: true,
        });
        return;
      }

      activeVideo.pause();
      activeVideo.currentTime = Math.max(
        0,
        Math.min(activeVideo.duration, Math.round(frameNumber) / rate()),
      );
      update(writeUrl);
    };

    const stepFrames = (count) => {
      seekToFrame(currentFrame() + count, true);
    };

    for (const video of videos) {
      video.addEventListener("focus", () => setActiveVideo(video, true));
      video.addEventListener("pointerdown", () => setActiveVideo(video, true));
      video.addEventListener("mouseenter", () => setActiveVideo(video, true));
      video.addEventListener("loadedmetadata", () => update(false));
      video.addEventListener("seeked", () => update(true));
      video.addEventListener("timeupdate", () => update(true));
    }

    document.querySelector("#back").addEventListener("click", () => stepFrames(-1));
    document.querySelector("#forward").addEventListener("click", () => stepFrames(1));
    fps.addEventListener("input", () => update(true));
    window.addEventListener("keydown", (event) => {
      if (event.target instanceof HTMLInputElement) return;
      let handled = true;
      if (event.key === "ArrowRight") {
        stepFrames(event.shiftKey ? 10 : 1);
      } else if (event.key === "ArrowLeft") {
        stepFrames(event.shiftKey ? -10 : -1);
      } else if (event.key === " ") {
        if (activeVideo.paused) activeVideo.play();
        else activeVideo.pause();
      } else {
        handled = false;
      }
      if (!handled) return;
      event.preventDefault();
      event.stopPropagation();
    }, { capture: true });

    const applyUrlState = () => {
      const params = new URL(location.href).searchParams;
      const requestedVideo = videoByActiveKey.get(params.get("active"));
      setActiveVideo(requestedVideo || activeVideo, false);
      const requestedFrame = Number(params.get("frame"));
      if (Number.isFinite(requestedFrame)) {
        seekToFrame(requestedFrame, false);
        return;
      }
      update(false);
    };

    document.body.tabIndex = -1;
    document.body.focus();
    applyUrlState();
  </script>
</body>
</html>
`;
};

const renderVideo = async (options: {
  captions: VideoModeCaption[];
  dialogPostFrame: { path: string; viewport: VideoModeViewport } | undefined;
  dialogPostHoldMs: number;
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
  const sourceRangeStart = options.sourceRange.start === undefined ? 0 : options.sourceRange.start;
  const sourceRangeEnd =
    options.sourceRange.end === undefined ? info.durationMs : options.sourceRange.end;
  const rangeStart = Math.max(0, Math.min(Math.round(sourceRangeStart), info.durationMs));
  const rangeEnd = Math.max(
    0,
    Math.min(Math.round(sourceRangeEnd), info.durationMs),
  );

  if (rangeEnd <= rangeStart) {
    console.warn(
      `videoMode source range is empty: start ${rangeStart}ms must be before end ${rangeEnd}ms`,
    );
    return false;
  }

  const highlightInputs = options.highlights
    .filter((highlight) => highlight.image)
    .map((highlight, index) => ({
      durationMs: Math.max(
        highlight.end - highlight.start,
        highlight.liveAction && highlight.actionEnd
          ? highlight.actionEnd - highlight.start + VIDEO_MODE_HIGHLIGHT_FRAME_MS
          : 0,
      ),
      image: highlight.image!,
      inputIndex: index + 1,
      path: join(options.outputDir, highlight.image!),
    }));
  const dialogPostFrameInput: DialogPostFrameInput | undefined = options.dialogPostFrame
    ? {
        inputIndex: highlightInputs.length + 1,
        path: options.dialogPostFrame.path,
        viewport: options.dialogPostFrame.viewport,
      }
    : undefined;
  const pointerInputOffset = highlightInputs.length + (dialogPostFrameInput ? 1 : 0);
  const shouldRenderPointer = options.highlightMode === "pointer" && options.highlights.length > 0;
  const cursorPointerInput: PointerInput | undefined = shouldRenderPointer
    ? {
        hotspot: VIDEO_MODE_POINTER_HOTSPOT,
        inputIndex: pointerInputOffset + 1,
        path: join(options.outputDir, VIDEO_MODE_POINTER_FILE),
        size: VIDEO_MODE_POINTER_SIZE,
        sourceSize: VIDEO_MODE_POINTER_SOURCE_SIZE,
      }
    : undefined;
  const clickPointerInput: PointerInput | undefined = shouldRenderPointer
    ? {
        hotspot: VIDEO_MODE_CLICK_POINTER_HOTSPOT,
        inputIndex: pointerInputOffset + 2,
        path: join(options.outputDir, VIDEO_MODE_CLICK_POINTER_FILE),
        size: VIDEO_MODE_CLICK_POINTER_SIZE,
        sourceSize: VIDEO_MODE_CLICK_POINTER_SOURCE_SIZE,
      }
    : undefined;
  const textPointerInput: PointerInput | undefined = shouldRenderPointer
    ? {
        hotspot: VIDEO_MODE_TEXT_POINTER_HOTSPOT,
        inputIndex: pointerInputOffset + 3,
        path: join(options.outputDir, VIDEO_MODE_TEXT_POINTER_FILE),
        size: VIDEO_MODE_TEXT_POINTER_SIZE,
        sourceSize: VIDEO_MODE_TEXT_POINTER_SOURCE_SIZE,
      }
    : undefined;
  if (cursorPointerInput) {
    await writeFile(cursorPointerInput.path, Buffer.from(VIDEO_MODE_POINTER_PNG, "base64"));
  }
  if (clickPointerInput) {
    await writeFile(clickPointerInput.path, Buffer.from(VIDEO_MODE_CLICK_POINTER_PNG, "base64"));
  }
  if (textPointerInput) {
    await writeFile(textPointerInput.path, Buffer.from(VIDEO_MODE_TEXT_POINTER_PNG, "base64"));
  }
  const segments = renderVideoSegments({
    deadAir: options.deadAir,
    finalEnd: rangeEnd,
    start: rangeStart,
    thresholdMs: options.thresholdMs,
  });
  const renderedCaptions = projectVideoCaptions(
    options.captions,
    renderedVideoPieces(
      videoPieces({
        highlights: options.highlights,
        segments,
      }),
    ),
  );
  const captionFile =
    renderedCaptions.length > 0 ? join(options.outputDir, VIDEO_MODE_CAPTIONS_FILE) : undefined;

  if (captionFile) {
    await writeFile(captionFile, assCaptions(renderedCaptions, info));
  }

  const filter = renderedVideoFilter({
    captionFile,
    clickPointerInput,
    cursorPointerInput,
    dialogPostFrameInput,
    dialogPostHoldMs: options.dialogPostHoldMs,
    finalHoldMs: options.finalHoldMs,
    highlightMode: options.highlightMode,
    highlightInputs,
    highlights: options.highlights,
    segments,
    textPointerInput,
    video: info,
  });

  if (!filter) {
    return false;
  }

  await execFile(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
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
      ...(dialogPostFrameInput
        ? ["-loop", "1", "-i", dialogPostFrameInput.path]
        : []),
      ...(cursorPointerInput ? ["-loop", "1", "-i", cursorPointerInput.path] : []),
      ...(clickPointerInput ? ["-loop", "1", "-i", clickPointerInput.path] : []),
      ...(textPointerInput ? ["-loop", "1", "-i", textPointerInput.path] : []),
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
      caption: async (_text, action) => {
        return await action();
      },
      deadAir: async (action) => {
        return await action();
      },
      getVideoTimestamp: () => 0,
      metadata: async () => ({
        captions: [],
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
  const captionMode = options.captions || "test-step";
  const highlight = resolveVideoModeHighlight(options);
  const skipMethods = options.skipMethods || ["waitFor"];
  const skipStackFrames = options.skipStackFrames || [];
  const typeFills = options.typeFills !== false;
  const deadAirThreshold = resolveDeadAirThreshold(options.deadAirThreshold);
  const trimStart = resolveTrimStart(options.trimStart);
  const state: VideoModeState = {
    captions: [],
    deadAirDepth: 0,
    deadAirSpans: [],
    highlightImageIndex: 0,
    highlights: [],
    outputs: {},
    sourceRange: {},
    startedAt: performance.now(),
  };
  const pendingDialogHighlights = new Set<Promise<void>>();
  let dialogHighlightQueue = Promise.resolve();
  const queueDialogHighlight = (capture: () => Promise<void>) => {
    const recording = dialogHighlightQueue.then(capture);
    dialogHighlightQueue = recording.catch(() => {});
    pendingDialogHighlights.add(recording);
    void recording.then(
      () => pendingDialogHighlights.delete(recording),
      () => pendingDialogHighlights.delete(recording),
    );
    return recording;
  };
  let testInfoForOutputPaths: TestInfo | undefined;
  const getVideoTimestamp = () => {
    const now = performance.now();
    return Math.round(now - (state.startedAt || now));
  };
  const controls: VideoModeControls = {
    caption: async (text, action) => {
      return await recordCaption(state, getVideoTimestamp, text, action);
    },
    deadAir: async (action) => {
      return await recordDeadAir(state, action);
    },
    getVideoTimestamp,
    metadata: async () => {
      await Promise.all(pendingDialogHighlights);
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
        try {
          return await next();
        } finally {
          recordActionElapsedDeadAirFromTiming(state, timing, { minimumMs: 0 });
        }
      }

      recordMiddlewareWaitBeforeVideoMode(state, timing);

      if (skipMethods.includes(method)) {
        try {
          return await next();
        } finally {
          if (timing.attachedAtStart) {
            recordActionElapsedDeadAirFromTiming(state, timing, { minimumMs: 50 });
          }
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
        const replacement =
          typeFills && method === "fill" ? await typedFillAction(locator, args) : undefined;
        if (recordedHighlight && replacement) {
          recordedHighlight.liveAction = true;
        }
        return await next(replacement);
      } finally {
        if (recordedHighlight && state.startedAt !== undefined) {
          recordedHighlight.actionEnd = Math.max(
            recordedHighlight.start,
            Math.round(performance.now() - state.startedAt),
          );
        }
        if (
          !recordedHighlight &&
          (timing.attachedAtStart || timing.attachedAt === undefined)
        ) {
          recordActionElapsedDeadAirFromTiming(state, timing, { minimumMs: 50 });
        }
        recordAttachedWaitFromTiming(state, timing);
      }
    },

    testLifecycle: (emitter) => {
      let dialogPage: Page | undefined;
      let onDialog: ((dialog: Dialog) => void) | undefined;
      let stopObservingPlaywrightSteps = () => {};
      const offBeforeTest = emitter.on("beforeTest", async ({ page, testInfo }) => {
        dialogHighlightQueue = Promise.resolve();
        state.captions = [];
        state.deadAirDepth = 0;
        state.deadAirSpans = [];
        state.highlightImageIndex = 0;
        state.highlights = [];
        state.lastDialogEndedAt = undefined;
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
        stopObservingPlaywrightSteps();
        if (captionMode === "test-step") {
          stopObservingPlaywrightSteps = observePlaywrightStepCaptions(
            testInfo,
            state,
            getVideoTimestamp,
          );
        }

        if (highlight.mode !== "off") {
          await page.addInitScript(installVideoModeDialogOverlay);
          await page.evaluate(installVideoModeDialogOverlay);
          dialogPage = page;
          const dialogEmitter = page as Page & {
            listenerCount(event: "dialog"): number;
            prependListener(event: "dialog", listener: (dialog: Dialog) => void): Page;
          };
          onDialog = (dialog) => {
            const dialogListenerCount = dialogEmitter.listenerCount("dialog");

            if (dialog.type() === "beforeunload") {
              if (dialogListenerCount === 1) {
                void dialog.dismiss();
              }
              return;
            }

            const originalAccept = dialog.accept.bind(dialog);
            const originalDismiss = dialog.dismiss.bind(dialog);
            const recordResolution = async (
              action: "accept" | "dismiss",
              promptText: string | undefined,
              resolveDialog: () => Promise<void>,
            ) => {
              let resolveRecording!: () => void;
              let rejectRecording!: (reason: unknown) => void;
              const dialogResolved = new Promise<void>((resolve, reject) => {
                resolveRecording = resolve;
                rejectRecording = reject;
              });
              const recording = queueDialogHighlight(async () => {
                await dialogResolved;
                await recordDialogHighlights({
                  action,
                  color: highlight.color,
                  dialog,
                  durationMs: highlight.durationMs,
                  page,
                  promptText,
                  state,
                  testInfo,
                  thickness: highlight.thickness,
                });
              });

              try {
                await resolveDialog();
                resolveRecording();
              } catch (error) {
                rejectRecording(error);
                await recording.catch(() => {});
                throw error;
              }

              await recording;
            };

            Object.assign(dialog, {
              accept: async (promptText?: string) => {
                await recordResolution("accept", promptText, () => originalAccept(promptText));
              },
              dismiss: async () => {
                await recordResolution("dismiss", undefined, originalDismiss);
              },
            });

            // Playwright auto-dismisses dialogs only when there are no dialog
            // listeners. videoMode must preserve that behavior even though its
            // observer necessarily counts as a listener.
            if (dialogListenerCount === 1) {
              void dialog.dismiss();
            }
          };
          dialogEmitter.prependListener("dialog", onDialog);
        }

        // Start the video from the moment the app's "ready" element first shows.
        // Kicked off now (before the test navigates), it resolves whenever the
        // element appears; a timeout or a page close just leaves the blank
        // detector to handle it. Never let it reject the test.
        if (trimStart.selector) {
          page
            .locator(trimStart.selector)
            .first()
            .waitFor({ state: "visible", timeout: TRIM_START_SELECTOR_TIMEOUT_MS })
            .then(() => {
              if (state.sourceRange.start === undefined) controls.setStartTime();
            })
            .catch(() => {});
        }
      });

      const offAfterTestFinalize = emitter.on("afterTestFinalize", async ({ page, testInfo }) => {
        await Promise.all(pendingDialogHighlights);
        const metadataBeforeVideo = metadataFor(state);
        const captions = metadataBeforeVideo.captions;
        const deadAir = metadataBeforeVideo.deadAir;
        const highlights = metadataBeforeVideo.highlights;
        const naturalPostDialogMs =
          state.lastDialogEndedAt === undefined
            ? 0
            : renderVideoSegments({
                deadAir,
                finalEnd: getVideoTimestamp(),
                start: state.lastDialogEndedAt,
                thresholdMs: deadAirThreshold,
              }).reduce((total, segment) => total + (segment.end - segment.start) / segment.speed, 0);
        const dialogPostHoldMs =
          state.lastDialogEndedAt === undefined
            ? 0
            : Math.max(0, DIALOG_POST_ROLL_MS - naturalPostDialogMs);
        // Note: sourceRange is read fresh from state below, not snapshotted here —
        // a selector `waitFor` can still resolve during the awaits in this handler
        // and call setStartTime(), and the render must see that.
        const video = page.video();

        if (video) {
          const paths = videoModeOutputPaths(testInfo);
          await mkdir(testInfo.outputDir, { recursive: true });
          let dialogPostFrame: { path: string; viewport: VideoModeViewport } | undefined;

          if (dialogPostHoldMs > 0 && !page.isClosed()) {
            const viewport = page.viewportSize();
            if (!viewport) {
              throw new Error("videoMode cannot capture a post-dialog frame without a viewport");
            }
            const path = join(testInfo.outputDir, VIDEO_MODE_DIALOG_POST_FRAME_FILE);
            await page.screenshot({ path, scale: "css" });
            dialogPostFrame = { path, viewport };
          }

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

          // No explicit or selector-driven start: fall back to detecting where
          // the blank startup ends in the recorded pixels, and trim to there
          // when the lead-in is long enough to be worth removing. The second
          // `undefined` check guards the window across the ffmpeg await: if a
          // selector start landed meanwhile, it wins.
          //
          // This start is in the raw recording's timebase (t=0 = context
          // creation), which is exactly what the ffmpeg trim wants. Highlights
          // and dead-air are in videoMode time (from `startedAt` at plugin
          // construction); the two origins differ only by the fixture-setup gap
          // between context creation and construction — sub-frame in practice and
          // independent of how long the app takes to paint — so annotations stay
          // aligned with the trimmed video. (`setStartTime` instead shares the
          // videoMode timebase, so its trim and annotations shift together.)
          if (trimStart.detectBlank && state.sourceRange.start === undefined) {
            const detectedStart = await detectBlankLeadInEndMs(paths.raw);
            if (
              detectedStart !== undefined &&
              detectedStart >= TRIM_START_MIN_LEAD_IN_MS &&
              state.sourceRange.start === undefined
            ) {
              state.sourceRange.start = detectedStart;
            }
          }

          // Read fresh, so an explicit, selector, or pixel-detected start all show.
          const sourceRange = metadataFor(state).sourceRange;

          if (
            captions.length > 0 ||
            highlights.length > 0 ||
            deadAirThreshold !== undefined ||
            finalHold > 0 ||
            sourceRangeIsSet(sourceRange)
          ) {
            const wroteRenderedVideo = await renderVideo({
              captions,
              deadAir,
              dialogPostFrame,
              dialogPostHoldMs,
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
          metadata.captions.length > 0 ||
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
        stopObservingPlaywrightSteps();
        offBeforeTest();
        offAfterTestFinalize();
        if (dialogPage && onDialog) {
          dialogPage.off("dialog", onDialog);
        }
      };
    },
  };
};
