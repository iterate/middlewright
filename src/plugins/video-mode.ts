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
const VIDEO_MODE_FINAL_FRAME_FILE = "video-mode-final-frame.png";
const VIDEO_MODE_CAPTIONS_FILE = "video-mode-captions.ass";
const VIDEO_MODE_DIALOGS_FILE = "video-mode-dialogs.ass";
// Playwright extends its final screencast frame by the Node-side time since
// that frame arrived, with a one-second minimum. Keep a known final paint
// stable beyond that minimum so raw duration and videoMode time share an
// endpoint without depending on browser-frame delivery latency.
const VIDEO_MODE_RECORDER_SETTLE_MS = 1100;
const VIDEO_MODE_FILL_REVEAL_MAX_CHARACTERS = 100;
const VIDEO_MODE_FILL_PRE_ACTION_FRAME_PADDING = 3;
// Pointer assets adapted from Pictogrammers Material Design Icons:
// cursor-default.svg, cursor-pointer.svg, and cursor-text.svg.
// Source: https://github.com/Templarian/MaterialDesign
// Icons are distributed under the Pictogrammers Free License / Apache 2.0.
const VIDEO_MODE_POINTER_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAIjElEQVR4nORbe2hWZRj/udWqpZIYRqam4g0rUdOgBC+gYlZITEUyUCGRRBFSLBOhP0RErZwUM2luFkbZhUmu2baGogvZxVvtD6PbmmJpttzcpnObvb9zzuN5vuP3+d2/7ywf+HG+857znXOe5zz39z0ZuMMpA3c43YXEUo8gYzfgY8pE/ESmHzAY7/y+4mx7qOO+pXhNgMzlGTQaVBrUG1QYjDG4G7aGZTr3yYAPhRHPA/G/Xxq8GORYm8ErBgcMOgw6HXTBNgnfmEWsJkDmpxtskoERI0bg0qVLssu3n+P8roaPzSBWEyBD42Rn/vz5OHPmDEpKSixBKFpn8IHBfQb3wBaMr0wiFgGIg+snA0OGDLG2s2bNQnV1NaZOnarPpyZ8Y/CIwb1wfUMGAp1lWigeDQj64L1790Z5eTkWL16shxkhymA7R2pDFnwihHg0IORDZ2ZmoqCgANu3b9fDDxsUG8yErQkihEykUQjxhMGwD7xq1SqUlZWhV69eMpRt8LHBcrh+QYfKlAshHhOIiKZPn46qqioMGDBA3/Mtg/cMKJm0OseU1AKjRo3CyZMnMXHiRD08F3Ye8RBc56jNISVCSFkx1LdvXxw9ehTz5s3Tw08ZfGvA2EkhiEmkzDkm1Qd4KSsrC/v27cPGjRv18KOwhTAZgUJIiXNMSzm8fv16FBUVaefY2+Bzg4VIsRDS1g+YM2cODh8+jH79buZTZPZdA6oHo4U4RzGJpDjHtDZExo0bhxMnTmD06NF6eKnBJwZ9ERghkuIc094R6t+/v5U+UyMUTTUoMWCOrZOmhDtHX7TEsrOzLZ+wbt06PTzcoNTgaSQxffZVT3DTpk1WlFBEM/jKgLFThOA1ibjId01R5gnMHJVzJMPvG7yJQOeYkPTZl11hZow1NTXe3sIq2HUE+48UArUh7vTZt23xgQMHora2FjNmzNDD7EKxohyEBDlHX88L9OzZEwcPHsTKlSv1MGMmnSM7UnELwfcTIxkZGdixYwd2796th+kgvjZ4HoERImrn2G1mhpYsWYJDhw7p9JlvP9/gNQTvOUYkhG41NTZlyhQcP34cQ4cOlSE+/+uwG6+sJ6J2jt1ubnDYsGFWhJg0aZIeZhpZBLvtpmuIsOlzPAJI2+RGnz59rN5CiMYrM0jdfb6tELr17DAbr1u3btVD/Q0KDe5HYIRIigb4gtasWYPi4mLtHEfB7jwzawwbHf4X6wNmz56NhQsX6iHmCBSAhMiQkSHR6wNSTm1tbVbDtaKiQg+3wGb+ukE73AnaLu//4xFAynv4HR0dOH36tNU/EHDfQ60GtXBDIp3hNQQ6w5sOPB4BpCQKsGNUWFhoVYjHjh2L5C+5Bk2w1V6rftAX5nsTGD9+fCSn/WPwI+xJ2J8QxToE3wuAfYELFy7oIar4Lwa/Gvzs/OYKFTItNi/gfgdcgdxCvo8CK1as0LsNBq8abDH4zKDKgNK5ClswRIsDrlKh7VMIIVenpHRiJBaiAFSMHwg74yNDZEwYb4Zt9wLutzjH2xEiApB8rwFMexctWqSHXoDNPN8u33Kzg8sG/zpbrlQTAYgGBPUJ3SIRWr16td5lKTgS9pulAMio9+1TAGSeQtI+IKECiDgMNjQ0YNq0aVabi7+jpcGDB2PBggV6iNUfGaMQxAzE9lsRyLy2/1so6Rpw5MgRTJgwwWpmnD17Fhs2bEAstHbtWr3LeXb6AzJHJsN5/5AvK6kC2LVrFyZPnhwQxvbs2YNz584hWuI0mqdBOh9ukkMGyax3PWLINy+UlCjQ2dmJ5cuXY9myZUGP5+bmIhZi5aeIFd+DCL7EJuLFmAn3AY2NjdaymLy8PD3MFZQHZGfnzp1oampCtDRz5kydGZLpl2Hn+7rsjWqOIB4BnJcfLEpIdXV1N+1d0Q8G62EnLszY0NzcbJlHLOTRAi7TlYkSb0M0IiHEkszwBpT2kwbfyyAblRcvXrSYU8Q+3Rdw7fNZg8U8wEVTsUQEEqMJHapDHxm8Azv+8+YMje3OPbvCXSuWtcIUGoXAAoQx+XEOUvXb29vlHIYiGno53HBFMG9/ziCLJsAG55gxYxAtcR0iJ0wc4gpUapd4fvH+YZkXZqIlMk/B0e7YeyOjOkhT5T80+Mt5GMZjEQAfip7xJZ5I5k+dOoVoiU0QTqkrmm1AldBacB1JigI3FKjWbxg8A5cx2vsfcLO0FrjpKj1fgVyIzYzS0lJES3v37tW7kvjcjVu/UQj7gmN1ghJjRb3/hr0snowzDW1GINPEZWf7O2zfYNG2bdsQKeXn52PkyJFYunSpHq6DzbQwLsxHRLFWdNoM2H5m/y0bbj+e16WAKByagBQlXc7/noC9NM4idn3Gjh0b9Eatra0W41u2bNGOT4haxhSRTRAphijkKwisA0JSIr4ZEnMQjZBK7arzgG1wc3MRAh3oBIPBvAAjR05OTsBF+fHF5s2bMXfuXOzfv9+bN/A6dLBvG/zpXPua5z63rQGEYtUAibOiCVQ/73cAIhD9yQycc6gpnOv/VC5YX1+PQYMGWVsulQmRJ9CffGfAEMCcQoohvnFdDbYiTB9AMxIr6S6rdzLSm5/Lm5BzmbgwgnAq6zFejK2v4cOHo7KyMti9qNpcGEHmybDWNHG2UgYH6wPclol4yPt5nNf5iPTFTEQA1Bb6Dc5wcsF0qN4kqyYyTqlIfz+YmUk5LCYn54atCRLV1urh2Qrd8GxFSGRYtIC1PSf4eqr//QY7UtTANR+dUInqC9rUb10Kh02GUj65AddviBaQcWaUOc4xhrXzcM1I1/uSVImz09AaEnFbPB0C8GoBwyc1oRfcWV2Z0dWtbi+zsg2WAkdcDqdjXkBnkdLZ1ZGjXT2XVn3N/HW4jIuT1YxH3K5L18SIzht01OC+zOYCrgYItJrHxbjQfwAAAP//th2pdAAAAAZJREFUAwBUhOKkqcK2WAAAAABJRU5ErkJggg==";
const VIDEO_MODE_POINTER_SOURCE_SIZE = 64;
const VIDEO_MODE_POINTER_SIZE = 28;
const VIDEO_MODE_POINTER_HOTSPOT = { x: 18, y: 6 };
const VIDEO_MODE_CLICK_POINTER_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAG+ElEQVR4nOxbXWxURRT+Si3+kj4oFCIvVFMIxsbwQFqopBiMPkDUkNCECDUqtjYmmPBA5MX4F436UKNNScUEo+iD2phIm6jRhhgKpdhAlRqolESwFOhDta1IkeL57tzZzs7eu7vd3VkuKV/y5e7M/dmZ756ZOfece2dhhmMWZjhuCIAZjpuQXxRYWxtXfeYN+RKAHV4kfFT4gPBuYZ+wR9gm/Beq45OIF8G5GAVwj0Lhi8LXhbcE7B8QPgUlxhWfphBORXAtAK/fKnw8jWOfFX4lvCz8D4lCOIFLAXjtZ4Qf6ora2lpUV1djwYIF6Ovrw65du7ytj1FhtfAP4SVMCeFUBFcCFPjsF5ayYs+ePdi4cWPCgWvXrkVbW5suNgvfEl6EmhcmEC+Ck4a6ui47/jsL5eXlOHr0aOCBx48fx5IlS3TxV2GNcEz4D5QQFIHDwYkVuPIDKMAjurBixYrQAxcvXow5c+bo4n3CEuFtwpuFRVCTqLOh6kIAbf736Iri4uKkJ8ydO9c8916o1WI21DJd6LfTiQguLSDTBvOuz/bJ3846T7hwhLLpPME2FWHq7hfm4JqhcPkskGmD2SbdcX33U7nQGcOVK5xNQ3mu7rzmdTUEsoV5t5276lEVwCTgUAyXAuSqwU6t4EZECDMcNwTADEcUVwEiL0sg4dICMn105UPUIigBZgUwp8JE0QKe97eMCn0sbISKDplBkZzFCyMxB8ybNy+omvGA54Q/C1/lYZh6QjRd5awsohC5hzbdh4UVrKiqqsKaNWtCTygpKcHIyAgWLlyI+fPnY2JiAuPj43o3O7xcWCe8U/gbVKSowPrPjBCJp8F169ahvb0dHR0dOHDgAM6cOYOmpiZPEAO3Cl8QMrb2tpA7s7aISC6DRUVFaGhowMDAAHbu3GkLwXBZg7BX+C6yFCKKq0AMFKKurg6nT59Gc3NzkEXUQ0Wem4SViI8jpiXEdeMI1dfXe0K0tLTYQhC1wh+Fn0LNE2lbxHXnCW7ZssUTYvfu3SgtLbV3PyZsF96FNKPK2QpQkKLsDMwynTx50hNi6dKl5q5y4ZNQQ4QiJI0sT0cA7Z7anpltZnlzYwkKcezYMWzYsMGsfkJ4B6bC66GB1XQF4InbhJ8IfxB2CD8QPi28H0plM4rrNJkRhE2bNplFJlduR3CCJa5dqVxhHsysxU/CMmvfKuM301j02LqE3f7vvM4v1jDg3WfnmVK7jPiMcxySCcDOM2f1DRI7b4N/9qDPa4LR0VGzyOcGmj/zijrDZA7P2BKdTACaENO2y3UFZ+D169djbGwMXV1d6OzsxP79+xEFnDhxwiyegzJ7M8ESOAmGCcAD3xdW6YrGxkZs3bo1dgCF0Ojp6fFc2MOHD+PQoUNmzt+DZZ5OwCyzgbNIM7cQJIA2k9gY53pbU1ODMCxbtsyjBh9kKER3d7eX+d28eTNcw7KAs/425URcEFJHxTjDt+jKsrIy7Nu3z3taiyIqKytx8OBBXXwHaqX6Szjik+8c8KUL/cKFh7CZmiLQrdyuK6jwypUrMTQ0hCiCvoABNlIHTJK+YpNsqaIIHwlf0hV8OouiCMPDw/YqMAjVcc3QCFKqtZonfCZ8RVdEUQRr/A9DhdPYcf2mmR1OiyFMgKvGBehEUIQ39MlREyFgAtTtD7KCOAQJoA9k5zlh0Jng5PG58DVEUIQAASaRhQDAlIKmAAzSfQn1xmekRLAEMMd/0MuWaQ0BfaAeAhSA/j6Xki+ELyNCIvT395tFbQFXED4PxJDMAsKsgCJ8DSWCt55qES5cuIBrgVOnTpnFP5FoAZNh56aygFQi7IAhAsPf+RaB0SFjCWRbziH4zk/bDwBSi8CHpR3+n3ljMd8iWON/CPEdz9oPANITYTuukQghK8AVJL56H4h0gxZhIuiJ8VsoS4g1iiKcP38ertHb22sWzfEfZAUJmE7UJpUIjMZu0wdThNWrVzu1BI791tZWs+oXJB//GQ0BE6lE+A6GCIwLVFRU4MiRI8g19u7d613bsDIOSf6RNv20PrrINHBpRogZU2DYiSEohsYYj3tI+J55AoMiIVngaWNwcNAe+wS/Nfge6kboR+C/oYThs4EWI6EjmSKZCAynrRK+KSyGe9BDpYOmLZGdZyxg1K8zvzmIQ67S4+bQ0OCMzBD6IqjIsouXMRgEYIK0E6qTTJuzw+OY+uqEnmxg54lcxO5tS2Ag0hwOOj7PyDKFsAOUmbSBnRtAsLs+6lN/dWJ+dpOAXNwVrayeGO19elLi3aIwdpIi05swaVzfnIzNT21Sfm+UK7O0RTCXnUmjkZyMzKxtpgJcDbn2RcR/cBU48ZnI5bg0RTB/6yWJDbTT1pkOA3s51kvyJX9r3/1QC/gfAAD//6xCl+IAAAAGSURBVAMApSDEOHMObm0AAAAASUVORK5CYII=";
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

export type VideoModeFillReveal = {
  cover?: {
    color: string;
    rect: VideoModeRect;
  };
  contentRect: VideoModeRect;
  image: string;
  initialRect: VideoModeRect;
  revealBands: { height: number; y: number }[];
  revealStops: number[];
};

/**
 * A synthetic camera pan rendered over a beyond-viewport screenshot. The live
 * page is never scrolled; the rendered video travels from the captured scroll
 * position to a window where the highlighted element is visible.
 */
export type VideoModePan = {
  /** Return to the live scroll position after the hold. */
  back: boolean;
  /** One-way pan duration in the rendered video (ms). */
  durationMs: number;
  /** Page scroll offset when the highlight was captured. */
  from: { x: number; y: number };
  /** Document-coordinate region covered by the highlight image. */
  imageRect: VideoModeRect;
  /** Page scroll offset the rendered pan travels to. */
  to: { x: number; y: number };
};

export type VideoModeHighlight = VideoModeSpan & {
  actionEnd?: number;
  color: string;
  dialog?: VideoModeDialogAnnotation;
  fillReveal?: VideoModeFillReveal;
  image?: string;
  method?: OverrideableMethod;
  pan?: VideoModePan;
  rect: VideoModeRect;
  sourceFrameAt?: number;
  thickness: number;
  viewport: VideoModeViewport;
};

export type VideoModeDialogAnnotation = {
  action: "accept" | "dismiss";
  defaultValue?: string;
  message: string;
  promptText?: string;
  type: "alert" | "confirm" | "prompt";
};

export type VideoModeAddressBar = VideoModeSpan & {
  url: string;
};

export type VideoModeMetadata = {
  schemaVersion: 1;
  timebase: "ms";
  addressBars: VideoModeAddressBar[];
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
   * Show the destination URL after `page.goto()` in the rendered video without
   * changing the live page or delaying navigation. Default: `{ holdMs: 1000 }`
   */
  addressBar?: false | { holdMs: number };
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
  /** Final hold duration in the rendered video (ms). Default: 1000 */
  finalHold?: number;
  /** Methods to skip highlighting. Default: [] */
  skipMethods?: OverrideableMethod[];
  /**
   * Skip highlighting for actions triggered from these files (matched as
   * substrings of stack frames). Useful for internal helpers like login
   * flows that shouldn't be slowed down. Default: []
   */
  skipStackFrames?: string[];
  /**
   * Maximum rendered duration for each dead-air span. Longer spans are sped up
   * so they fit within this duration. Default: 300
   */
  deadAirThreshold?: number;
  /**
   * Where the rendered video starts. An explicit `setStartTime()` always wins
   * over this.
   *
   * - `"auto"` (default): start when the first locator action is invoked,
   *   including that action's Playwright auto-wait.
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

type VideoModeState = {
  addressBars: VideoModeAddressBar[];
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

type VideoModeDialogLayout = {
  buttons: Record<"accept" | "dismiss", VideoModeRect | undefined>;
  inputRect?: VideoModeRect;
  messageLines: string[];
  panelRect: VideoModeRect;
};

type RenderedVideoDialog = VideoModeSpan & {
  annotation: VideoModeDialogAnnotation;
  phase: "decision" | "fill";
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
  frameDurationMs: number;
};

type VideoFilter = {
  outputLabel: string;
  value: string;
};

type VideoPiece = {
  addressBar?: VideoModeAddressBar;
  end: number;
  highlight?: VideoModeHighlight;
  /**
   * Set when this pan piece follows another pan piece directly: the camera
   * enters from the previous pan's destination instead of the live scroll
   * position, with a travel time matching that (possibly zero) distance.
   */
  panEntry?: { durationMs: number; from: { x: number; y: number } };
  /**
   * Set on a return pan directly followed by another pan piece: the camera
   * hands over to the next pan instead of travelling back first.
   */
  panBackSuppressed?: boolean;
  postAction?: VideoModeHighlight;
  preAction?: VideoModeHighlight;
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
  highlight: VideoModeHighlight;
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
const PAN_SPEED_PX_PER_SECOND = 1800;
const PAN_MIN_MS = 400;
const PAN_MAX_MS = 1000;
const PAN_MARGIN_PX = 24;
// Chromium implements beyond-viewport capture by momentarily resizing the
// renderer, which leaks one zoomed-out frame into the screencast. The pan
// piece consumes the capture span plus this settle margin from the source so
// the flash never reaches the rendered video.
const PAN_CAPTURE_SETTLE_MS = 150;

type HighlightInput = {
  image: string;
  inputIndex: number;
  path: string;
};

type StillFrameInput = {
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
  const value = thresholdMs === undefined ? 300 : thresholdMs;

  if (!Number.isFinite(value) || value < 0) {
    throw new Error("videoMode deadAirThreshold must be a non-negative number");
  }

  return value;
};

type ResolvedTrimStart = {
  selector?: string;
  detectBlank: boolean;
  firstLocator: boolean;
};

const resolveAddressBar = (value: VideoModeOptions["addressBar"]) => {
  if (value === false) {
    return undefined;
  }

  return {
    holdMs: resolveNonNegativeNumber({
      defaultValue: 1000,
      name: "videoMode addressBar.holdMs",
      value: value?.holdMs,
    }),
  };
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
    return { selector, detectBlank: true, firstLocator: false };
  }

  switch (value) {
    case "never":
      return { detectBlank: false, firstLocator: false };
    case "auto":
      return { detectBlank: false, firstLocator: true };
    case "detect-blank":
      return { detectBlank: true, firstLocator: false };
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
const BLANK_START_SAMPLE_FPS = 5;
const VIDEO_ANALYSIS_SAMPLE_SIZE = 48;
const BLANK_START_MAX_SCAN_MS = 30_000;
// Mean per-pixel greyscale delta (0-255) above which a frame counts as "changed"
// from the opening frame. Comfortably above VP8 quantisation noise on a static
// scene (which stays ~0) and below the jump when real content paints.
const BLANK_START_DIFF_THRESHOLD = 1.5;

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
  const size = VIDEO_ANALYSIS_SAMPLE_SIZE;
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
        `fps=${BLANK_START_SAMPLE_FPS},scale=${size}:${size},format=gray`,
        "-t",
        formatSeconds(BLANK_START_MAX_SCAN_MS),
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
    ) > BLANK_START_DIFF_THRESHOLD;

  // First frame that differs from the opening frame *and* stays changed (two
  // consecutive samples), so a single decode blip can't trip it.
  for (let index = 1; index < frameCount - 1; index += 1) {
    if (hasChanged(index) && hasChanged(index + 1)) {
      return Math.round((index / BLANK_START_SAMPLE_FPS) * 1000);
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

const translateVideoSpan = (span: VideoModeSpan, offsetMs: number): VideoModeSpan => {
  return {
    end: Math.max(0, Math.round(span.end + offsetMs)),
    start: Math.max(0, Math.round(span.start + offsetMs)),
  };
};

const translateVideoTimeline = (options: {
  addressBars: VideoModeAddressBar[];
  captions: VideoModeCaption[];
  deadAir: VideoModeSpan[];
  highlights: VideoModeHighlight[];
  offsetMs: number;
}) => {
  return {
    addressBars: options.addressBars.map((addressBar) => ({
      ...translateVideoSpan(addressBar, options.offsetMs),
      url: addressBar.url,
    })),
    captions: options.captions.map((caption) => ({
      ...translateVideoSpan(caption, options.offsetMs),
      text: caption.text,
    })),
    deadAir: options.deadAir.map((span) => translateVideoSpan(span, options.offsetMs)),
    highlights: options.highlights.map((highlight) => {
      const start = Math.max(0, Math.round(highlight.start + options.offsetMs));
      return {
        ...highlight,
        dialog: highlight.dialog
          ? { ...highlight.dialog }
          : undefined,
        sourceFrameAt:
          highlight.sourceFrameAt === undefined
            ? undefined
            : Math.max(0, Math.round(highlight.sourceFrameAt + options.offsetMs)),
        actionEnd:
          highlight.actionEnd === undefined
            ? undefined
            : Math.max(start, Math.round(highlight.actionEnd + options.offsetMs)),
        end: start + (highlight.end - highlight.start),
        start,
      };
    }),
  };
};

const translateSourceRange = (sourceRange: VideoModeSourceRange, offsetMs: number) => {
  return {
    ...(sourceRange.end === undefined
      ? {}
      : { end: Math.max(0, Math.round(sourceRange.end + offsetMs)) }),
    ...(sourceRange.start === undefined
      ? {}
      : { start: Math.max(0, Math.round(sourceRange.start + offsetMs)) }),
  };
};

const sourceRangeIsSet = (sourceRange: VideoModeSourceRange) => {
  return sourceRange.start !== undefined || sourceRange.end !== undefined;
};

const metadataFor = (state: VideoModeState): VideoModeMetadata => {
  return {
    addressBars: state.addressBars
      .filter((addressBar) => addressBar.end > addressBar.start)
      .sort((left, right) => left.start - right.start || left.end - right.end),
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

const wrapVideoModeDialogText = (text: string, maxCharacters: number) => {
  const lines: string[] = [];

  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";

    for (const word of words.length > 0 ? words : [""]) {
      const chunks = word.match(new RegExp(`.{1,${maxCharacters}}`, "gu")) || [""];
      for (const chunk of chunks) {
        const candidate = line ? `${line} ${chunk}` : chunk;
        if (candidate.length <= maxCharacters) {
          line = candidate;
          continue;
        }
        lines.push(line);
        line = chunk;
      }
    }

    lines.push(line);
  }

  return lines.slice(0, 8);
};

const videoModeDialogLayout = (options: {
  message: string;
  type: VideoModeDialogAnnotation["type"];
  viewport: VideoModeViewport;
}): VideoModeDialogLayout => {
  const scale = Math.max(0.75, Math.min(1.5, options.viewport.height / 600));
  const pixels = (value: number) => Math.round(value * scale);
  const panelWidth = Math.min(pixels(480), options.viewport.width - pixels(48));
  const padding = pixels(24);
  const contentWidth = panelWidth - padding * 2;
  const bodyFontSize = pixels(15);
  const bodyLineHeight = pixels(22);
  const messageLines = wrapVideoModeDialogText(
    options.message,
    Math.max(12, Math.floor(contentWidth / (bodyFontSize * 0.56))),
  );
  const titleHeight = pixels(24);
  const titleGap = pixels(10);
  const inputGap = options.type === "prompt" ? pixels(18) : 0;
  const inputHeight = options.type === "prompt" ? pixels(38) : 0;
  const actionsGap = pixels(22);
  const buttonHeight = pixels(36);
  const panelHeight =
    padding * 2 +
    titleHeight +
    titleGap +
    messageLines.length * bodyLineHeight +
    inputGap +
    inputHeight +
    actionsGap +
    buttonHeight;
  const panelRect = {
    height: panelHeight,
    width: panelWidth,
    x: Math.round((options.viewport.width - panelWidth) / 2),
    y: Math.round((options.viewport.height - panelHeight) / 2),
  };
  const buttonWidth = pixels(78);
  const buttonGap = pixels(10);
  const buttonY = panelRect.y + panelRect.height - padding - buttonHeight;
  const acceptRect = {
    height: buttonHeight,
    width: buttonWidth,
    x: panelRect.x + panelRect.width - padding - buttonWidth,
    y: buttonY,
  };
  const dismissRect =
    options.type === "alert"
      ? undefined
      : {
          height: buttonHeight,
          width: buttonWidth,
          x: acceptRect.x - buttonGap - buttonWidth,
          y: buttonY,
        };
  const inputRect =
    options.type === "prompt"
      ? {
          height: inputHeight,
          width: contentWidth,
          x: panelRect.x + padding,
          y:
            panelRect.y +
            padding +
            titleHeight +
            titleGap +
            messageLines.length * bodyLineHeight +
            inputGap,
        }
      : undefined;

  return {
    buttons: { accept: acceptRect, dismiss: dismissRect },
    inputRect,
    messageLines,
    panelRect,
  };
};

const recordDialogHighlights = async (options: {
  action: "accept" | "dismiss";
  color: string;
  defaultValue: string;
  durationMs: number;
  message: string;
  openedAt: number;
  promptText?: string;
  state: VideoModeState;
  thickness: number;
  type: VideoModeDialogAnnotation["type"];
  viewport: VideoModeViewport;
}) => {
  const action = options.type === "alert" ? "accept" : options.action;
  if (options.state.startedAt === undefined || options.durationMs <= 0) {
    return;
  }

  const layout = videoModeDialogLayout({
    message: options.message,
    type: options.type,
    viewport: options.viewport,
  });
  const dialog: VideoModeDialogAnnotation = {
    action,
    ...(options.type === "prompt" ? { defaultValue: options.defaultValue } : {}),
    message: options.message,
    ...(options.promptText === undefined ? {} : { promptText: options.promptText }),
    type: options.type,
  };
  const resolvedAt = Math.round(performance.now() - options.state.startedAt);
  const record = (method: OverrideableMethod, rect: VideoModeRect, start: number) => {
    options.state.highlights.push({
      actionEnd: start,
      color: options.color,
      dialog,
      end: start + Math.round(options.durationMs),
      method,
      rect,
      sourceFrameAt: options.openedAt,
      start,
      thickness: options.thickness,
      viewport: options.viewport,
    });
  };
  let decisionStart = resolvedAt;

  if (
    dialog.type === "prompt" &&
    action === "accept" &&
    options.promptText !== undefined &&
    layout.inputRect
  ) {
    record("fill", layout.inputRect, resolvedAt);
    decisionStart += 1;
  }

  const buttonRect = layout.buttons[action];
  if (!buttonRect) {
    throw new Error(`videoMode dialog layout has no ${action} button`);
  }
  record("click", buttonRect, decisionStart);
  options.state.lastDialogEndedAt = decisionStart;
};

const panDurationMs = (from: { x: number; y: number }, to: { x: number; y: number }) => {
  return Math.round(
    Math.min(
      PAN_MAX_MS,
      Math.max(
        PAN_MIN_MS,
        (Math.hypot(to.x - from.x, to.y - from.y) / PAN_SPEED_PX_PER_SECOND) * 1000,
      ),
    ),
  );
};

const panScrollTarget = (options: {
  documentSize: number;
  scroll: number;
  start: number;
  size: number;
  viewportSize: number;
}) => {
  const documentStart = options.start + options.scroll;
  const fullyVisible =
    documentStart >= options.scroll &&
    documentStart + options.size <= options.scroll + options.viewportSize;

  if (fullyVisible) {
    return options.scroll;
  }

  // Center the element, matching how Chromium scrolls for actions — so a
  // wait-then-act pan pair lands on the same view — and keeping the target
  // clear of the caption band at the bottom. Oversized elements align to
  // their start instead.
  const target =
    options.size + PAN_MARGIN_PX * 2 > options.viewportSize
      ? documentStart - PAN_MARGIN_PX
      : Math.round(documentStart + options.size / 2 - options.viewportSize / 2);

  return Math.max(
    0,
    Math.min(target, Math.max(0, options.documentSize - options.viewportSize)),
  );
};

const recordHighlight = async (options: {
  /**
   * How an offscreen target is shown: "return" pans to it and back (the live
   * page keeps its scroll position), "stay" pans to it and remains (the
   * action itself scrolls the live page there).
   */
  pan: "off" | "return" | "stay";
  color: string;
  durationMs: number;
  locator: Locator;
  method: OverrideableMethod;
  requireVisible: boolean;
  startAfterScreenshot: boolean;
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
    if (options.requireVisible && !(await options.locator.isVisible())) {
      return;
    }

    const snapshot = await options.locator.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      let clippedByScrollContainer = false;
      for (
        let ancestor = element.parentElement;
        ancestor && ancestor !== document.documentElement;
        ancestor = ancestor.parentElement
      ) {
        const canScroll =
          (ancestor.scrollHeight > ancestor.clientHeight + 1 ||
            ancestor.scrollWidth > ancestor.clientWidth + 1) &&
          /auto|scroll|hidden/.test(getComputedStyle(ancestor).overflow);
        if (!canScroll) continue;
        const box = ancestor.getBoundingClientRect();
        if (
          rect.top < box.top - 1 ||
          rect.bottom > box.bottom + 1 ||
          rect.left < box.left - 1 ||
          rect.right > box.right + 1
        ) {
          clippedByScrollContainer = true;
          break;
        }
      }
      return {
        clippedByScrollContainer,
        document: {
          height: document.documentElement.scrollHeight,
          width: document.documentElement.scrollWidth,
        },
        rect: {
          height: rect.height,
          width: rect.width,
          x: rect.left,
          y: rect.top,
        },
        scroll: { x: window.scrollX, y: window.scrollY },
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

    const offscreen =
      snapshot.rect.x < 0 ||
      snapshot.rect.y < 0 ||
      snapshot.rect.x + snapshot.rect.width > snapshot.viewport.width ||
      snapshot.rect.y + snapshot.rect.height > snapshot.viewport.height;
    const panTo =
      options.pan !== "off" && offscreen && !snapshot.clippedByScrollContainer
        ? {
            x: panScrollTarget({
              documentSize: snapshot.document.width,
              scroll: snapshot.scroll.x,
              size: snapshot.rect.width,
              start: snapshot.rect.x,
              viewportSize: snapshot.viewport.width,
            }),
            y: panScrollTarget({
              documentSize: snapshot.document.height,
              scroll: snapshot.scroll.y,
              size: snapshot.rect.height,
              start: snapshot.rect.y,
              viewportSize: snapshot.viewport.height,
            }),
          }
        : undefined;
    // The image covers both scroll windows. A "stay" pan adopts the action's
    // real scroll destination afterwards, so its capture extends one extra
    // viewport in the travel direction in case the browser scrolls further
    // than the minimal estimate.
    const panImageAxis = (axis: {
      documentSize: number;
      from: number;
      to: number;
      viewportSize: number;
    }) => {
      let low = Math.min(axis.from, axis.to);
      let high = Math.max(axis.from, axis.to) + axis.viewportSize;
      if (options.pan === "stay") {
        if (axis.to > axis.from) high += axis.viewportSize;
        if (axis.to < axis.from) low -= axis.viewportSize;
      }
      low = Math.max(0, low);
      high = Math.min(Math.max(axis.documentSize, axis.viewportSize), high);
      return { size: high - low, start: low };
    };
    const pan: VideoModePan | undefined =
      panTo && (panTo.x !== snapshot.scroll.x || panTo.y !== snapshot.scroll.y)
        ? (() => {
            const horizontal = panImageAxis({
              documentSize: snapshot.document.width,
              from: snapshot.scroll.x,
              to: panTo.x,
              viewportSize: snapshot.viewport.width,
            });
            const vertical = panImageAxis({
              documentSize: snapshot.document.height,
              from: snapshot.scroll.y,
              to: panTo.y,
              viewportSize: snapshot.viewport.height,
            });
            return {
              back: options.pan === "return",
              durationMs: panDurationMs(snapshot.scroll, panTo),
              from: snapshot.scroll,
              imageRect: {
                height: vertical.size,
                width: horizontal.size,
                x: horizontal.start,
                y: vertical.start,
              },
              to: panTo,
            };
          })()
        : undefined;

    const image = pan
      ? `video-mode-pan-${options.state.highlightImageIndex}.png`
      : `video-mode-highlight-${options.state.highlightImageIndex}.png`;
    options.state.highlightImageIndex += 1;
    const imagePath = join(options.testInfo.outputDir, image);
    await mkdir(options.testInfo.outputDir, { recursive: true });
    const beforeScreenshot = Math.round(performance.now() - options.state.startedAt);
    await options.locator.page().screenshot(
      pan
        ? { clip: pan.imageRect, fullPage: true, path: imagePath, scale: "css" }
        : { path: imagePath, scale: "css" },
    );
    const afterScreenshot = Math.round(performance.now() - options.state.startedAt);
    // A pan starts at the pre-capture footage (its first synthetic frame is
    // pixel-identical to it) and consumes the capture flash from the source.
    const start = pan
      ? beforeScreenshot
      : options.startAfterScreenshot
        ? afterScreenshot
        : beforeScreenshot;

    const highlight: VideoModeHighlight = {
      actionEnd: pan ? afterScreenshot + PAN_CAPTURE_SETTLE_MS : undefined,
      color: options.color,
      end: start + Math.round(options.durationMs),
      image,
      method: options.method,
      pan,
      rect: pan
        ? {
            height: snapshot.rect.height,
            width: snapshot.rect.width,
            x: snapshot.rect.x + snapshot.scroll.x - pan.to.x,
            y: snapshot.rect.y + snapshot.scroll.y - pan.to.y,
          }
        : snapshot.rect,
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

/**
 * A "stay" pan is captured before the action, but the browser performs the
 * real scroll during it. Adopt the actual post-action scroll position as the
 * pan destination so the synthetic pan lands exactly where live footage
 * resumes, and consume the action's own footage (the instant scroll jump)
 * from the source.
 */
const finalizePanHighlightAfterAction = async (options: {
  highlight: VideoModeHighlight;
  locator: Locator;
  state: VideoModeState;
}) => {
  const pan = options.highlight.pan;
  if (!pan || pan.back || options.state.startedAt === undefined) {
    return;
  }

  try {
    const scroll = await options.locator.evaluate(() => ({
      x: window.scrollX,
      y: window.scrollY,
    }));
    const documentRect = {
      x: options.highlight.rect.x + pan.to.x,
      y: options.highlight.rect.y + pan.to.y,
    };
    const actionEnd =
      Math.round(performance.now() - options.state.startedAt) + PAN_CAPTURE_SETTLE_MS;
    if (Math.hypot(scroll.x - pan.from.x, scroll.y - pan.from.y) < 1) {
      // The action left live footage at its original viewport. Keep the
      // estimated destination (where the target is visible), then return to
      // the unchanged page instead of collapsing into an idle offscreen hold.
      pan.back = true;
      options.highlight.actionEnd = actionEnd;
      return;
    }
    pan.durationMs = panDurationMs(pan.from, scroll);
    pan.to = scroll;
    options.highlight.rect = {
      ...options.highlight.rect,
      x: documentRect.x - scroll.x,
      y: documentRect.y - scroll.y,
    };
    options.highlight.actionEnd = actionEnd;
  } catch {
    // Element may disappear during the action; keep the estimated pan.
  }
};

const recordFillReveal = async (options: {
  highlight: VideoModeHighlight;
  locator: Locator;
  state: VideoModeState;
  testInfo: TestInfo;
}) => {
  const initialRect = { ...options.highlight.rect };
  try {
    const snapshot = await options.locator.evaluate((element, captureOptions) => {
      if (
        !(element instanceof HTMLInputElement) &&
        !(element instanceof HTMLTextAreaElement)
      ) {
        return;
      }

      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const pixels = (value: string) => Number.parseFloat(value) || 0;
      const geometry = {
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
      const rectChanged =
        Math.abs(rect.height - captureOptions.expectedRect.height) > 1 ||
        Math.abs(rect.width - captureOptions.expectedRect.width) > 1 ||
        Math.abs(rect.left - captureOptions.expectedRect.x) > 1 ||
        Math.abs(rect.top - captureOptions.expectedRect.y) > 1;
      const isTextarea = element instanceof HTMLTextAreaElement;
      const value = element.value;
      const scrollChanged =
        element.scrollLeft > 0 ||
        element.scrollTop > 0 ||
        (isTextarea &&
          (element.scrollHeight > element.clientHeight + 1 ||
            element.scrollWidth > element.clientWidth + 1));

      if (
        value.length === 0 ||
        value.length > captureOptions.maxCharacters ||
        style.direction === "rtl" ||
        !["left", "start"].includes(style.textAlign) ||
        (element instanceof HTMLInputElement && element.type === "password")
      ) {
        return { ...geometry, kind: "fallback" as const };
      }

      const contentRect = {
        height:
          rect.height -
          pixels(style.borderTopWidth) -
          pixels(style.borderBottomWidth) -
          pixels(style.paddingTop) -
          pixels(style.paddingBottom),
        width:
          rect.width -
          pixels(style.borderLeftWidth) -
          pixels(style.borderRightWidth) -
          pixels(style.paddingLeft) -
          pixels(style.paddingRight),
        x: rect.left + pixels(style.borderLeftWidth) + pixels(style.paddingLeft),
        y: rect.top + pixels(style.borderTopWidth) + pixels(style.paddingTop),
      };

      if (contentRect.width <= 0 || contentRect.height <= 0) {
        return { ...geometry, kind: "fallback" as const };
      }

      const backgroundChannels = style.backgroundColor
        .match(/[\d.]+/g)
        ?.map(Number);
      const backgroundColor =
        backgroundChannels &&
        backgroundChannels.length >= 3 &&
        (backgroundChannels[3] === undefined || backgroundChannels[3] >= 0.99)
          ? `#${backgroundChannels
              .slice(0, 3)
              .map((channel) => Math.max(0, Math.min(255, Math.round(channel))))
              .map((channel) => channel.toString(16).padStart(2, "0"))
              .join("")}`
          : undefined;
      const needsBestEffort = rectChanged || scrollChanged || value.includes("\n");

      if (needsBestEffort) {
        if (!backgroundColor) {
          return { ...geometry, kind: "fallback" as const };
        }
        const stopCount = Math.max(4, Math.min(12, Math.ceil(contentRect.width / 64)));
        const revealBands = (() => {
          if (!isTextarea) {
            return [{ height: contentRect.height, y: 0 }];
          }

          let lineHeight = pixels(style.lineHeight);
          if (lineHeight <= 0) {
            const probe = document.createElement("span");
            Object.assign(probe.style, {
              display: "inline-block",
              font: style.font,
              lineHeight: style.lineHeight,
              pointerEvents: "none",
              position: "fixed",
              visibility: "hidden",
              whiteSpace: "pre",
            });
            probe.textContent = "M";
            (document.body || document.documentElement).append(probe);
            const oneLineHeight = probe.getBoundingClientRect().height;
            probe.textContent = "M\nM";
            lineHeight = probe.getBoundingClientRect().height - oneLineHeight;
            probe.remove();
          }
          if (lineHeight <= 0) {
            return [{ height: contentRect.height, y: 0 }];
          }

          const bands: { height: number; y: number }[] = [];
          for (
            let y = -(element.scrollTop % lineHeight);
            y < contentRect.height;
            y += lineHeight
          ) {
            const top = Math.max(0, y);
            const bottom = Math.min(contentRect.height, y + lineHeight);
            if (bottom > top) {
              bands.push({ height: bottom - top, y: top });
            }
          }
          return bands;
        })();
        return {
          ...geometry,
          contentRect,
          cover: { color: backgroundColor, rect: geometry.rect },
          kind: "reveal" as const,
          replaceGeometry: true,
          revealBands,
          revealStops: Array.from({ length: stopCount }, (_, index) =>
            Math.ceil((contentRect.width * (index + 1)) / stopCount),
          ),
        };
      }

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) {
        return { ...geometry, kind: "fallback" as const };
      }
      context.font = style.font;
      const graphemes = Array.from(
        new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value),
        ({ segment }) => segment,
      );
      const letterSpacing = pixels(style.letterSpacing);
      const textIndent = pixels(style.textIndent);
      const revealStops = graphemes.map((_, index) => {
        const prefix = graphemes.slice(0, index + 1).join("");
        return Math.ceil(
          textIndent +
            context.measureText(prefix).actualBoundingBoxRight +
            letterSpacing * index,
        );
      });
      revealStops[revealStops.length - 1] = Math.ceil(contentRect.width);

      return {
        ...geometry,
        contentRect,
        cover: backgroundColor
          ? { color: backgroundColor, rect: contentRect }
          : undefined,
        kind: "reveal" as const,
        replaceGeometry: false,
        revealBands: [{ height: contentRect.height, y: 0 }],
        revealStops,
      };
    }, {
      expectedRect: options.highlight.rect,
      maxCharacters: VIDEO_MODE_FILL_REVEAL_MAX_CHARACTERS,
    });

    if (!snapshot) {
      return;
    }

    const image = `video-mode-fill-${options.state.highlightImageIndex}.png`;
    options.state.highlightImageIndex += 1;
    await mkdir(options.testInfo.outputDir, { recursive: true });
    await options.locator.page().screenshot({
      path: join(options.testInfo.outputDir, image),
      scale: "css",
    });
    if (snapshot.kind === "fallback") {
      options.highlight.image = image;
      options.highlight.rect = snapshot.rect;
      options.highlight.viewport = snapshot.viewport;
      return;
    }
    if (snapshot.replaceGeometry) {
      options.highlight.rect = snapshot.rect;
      options.highlight.viewport = snapshot.viewport;
    }
    options.highlight.fillReveal = {
      contentRect: snapshot.contentRect,
      cover: snapshot.cover,
      image,
      initialRect,
      revealBands: snapshot.revealBands,
      revealStops: snapshot.revealStops,
    };
  } catch {
    // A disappearing target or failed post-action screenshot keeps the normal
    // stable pre-action highlight.
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

const videoModeGraphemes = (text: string) =>
  Array.from(
    new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
    ({ segment }) => segment,
  );

const assColor = (hex: `#${string}`) => {
  const red = hex.slice(1, 3);
  const green = hex.slice(3, 5);
  const blue = hex.slice(5, 7);
  return `&H${blue}${green}${red}&`;
};

const assRectangle = (rect: VideoModeRect) =>
  `m ${rect.x} ${rect.y} l ${rect.x + rect.width} ${rect.y} l ${rect.x + rect.width} ${rect.y + rect.height} l ${rect.x} ${rect.y + rect.height}`;

const assShapeEvent = (options: {
  alpha: string;
  color: `#${string}`;
  end: number;
  layer: number;
  rect: VideoModeRect;
  start: number;
}) =>
  `Dialogue: ${options.layer},${formatAssTime(options.start)},${formatAssTime(options.end)},DialogShape,,0,0,0,,{\\an7\\pos(0,0)\\p1\\bord0\\shad0\\1c${assColor(options.color)}\\1a&H${options.alpha}&}${assRectangle(options.rect)}`;

const assTextEvent = (options: {
  alignment: number;
  clip?: VideoModeRect;
  color: `#${string}`;
  end: number;
  layer: number;
  position: { x: number; y: number };
  start: number;
  style: "DialogBody" | "DialogButton" | "DialogInput" | "DialogTitle";
  text: string;
}) => {
  const clip = options.clip
    ? `\\clip(${options.clip.x},${options.clip.y},${options.clip.x + options.clip.width},${options.clip.y + options.clip.height})`
    : "";
  return `Dialogue: ${options.layer},${formatAssTime(options.start)},${formatAssTime(options.end)},${options.style},,0,0,0,,{\\an${options.alignment}\\pos(${options.position.x},${options.position.y})\\q2\\1c${assColor(options.color)}${clip}}${escapeAssText(options.text)}`;
};

const assDialogAnnotations = (options: {
  dialogs: RenderedVideoDialog[];
  video: { height: number; width: number };
}) => {
  const scale = Math.max(0.75, Math.min(1.5, options.video.height / 600));
  const pixels = (value: number) => Math.round(value * scale);
  const events = options.dialogs.flatMap((dialog) => {
    const { annotation } = dialog;
    const sceneViewport = scaledViewportSize(dialog.viewport, options.video);
    const layout = videoModeDialogLayout({
      message: annotation.message,
      type: annotation.type,
      viewport: sceneViewport,
    });
    const panel = layout.panelRect;
    const padding = pixels(24);
    const titleY = panel.y + padding;
    const messageY = titleY + pixels(34);
    const buttonRects = [layout.buttons.dismiss, layout.buttons.accept].filter(
      (rect): rect is VideoModeRect => Boolean(rect),
    );
    const selectedAction = dialog.phase === "decision" ? annotation.action : undefined;
    const shapeEvents = [
      assShapeEvent({
        alpha: "69",
        color: "#0f172a",
        end: dialog.end,
        layer: 0,
        rect: { height: sceneViewport.height, width: sceneViewport.width, x: 0, y: 0 },
        start: dialog.start,
      }),
      assShapeEvent({
        alpha: "70",
        color: "#000000",
        end: dialog.end,
        layer: 1,
        rect: {
          height: panel.height + pixels(8),
          width: panel.width + pixels(8),
          x: panel.x - pixels(4),
          y: panel.y + pixels(8),
        },
        start: dialog.start,
      }),
      assShapeEvent({
        alpha: "00",
        color: "#d1d5db",
        end: dialog.end,
        layer: 2,
        rect: panel,
        start: dialog.start,
      }),
      assShapeEvent({
        alpha: "00",
        color: "#ffffff",
        end: dialog.end,
        layer: 3,
        rect: {
          height: panel.height - pixels(2),
          width: panel.width - pixels(2),
          x: panel.x + pixels(1),
          y: panel.y + pixels(1),
        },
        start: dialog.start,
      }),
    ];

    if (layout.inputRect) {
      shapeEvents.push(
        assShapeEvent({
          alpha: "00",
          color: "#9ca3af",
          end: dialog.end,
          layer: 4,
          rect: layout.inputRect,
          start: dialog.start,
        }),
        assShapeEvent({
          alpha: "00",
          color: "#ffffff",
          end: dialog.end,
          layer: 5,
          rect: {
            height: layout.inputRect.height - pixels(2),
            width: layout.inputRect.width - pixels(2),
            x: layout.inputRect.x + pixels(1),
            y: layout.inputRect.y + pixels(1),
          },
          start: dialog.start,
        }),
      );
    }

    for (const rect of buttonRects) {
      const action = rect === layout.buttons.accept ? "accept" : "dismiss";
      const selected = selectedAction === action;
      shapeEvents.push(
        assShapeEvent({
          alpha: "00",
          color: selected ? "#2563eb" : "#9ca3af",
          end: dialog.end,
          layer: 4,
          rect,
          start: dialog.start,
        }),
        assShapeEvent({
          alpha: "00",
          color: selected ? "#2563eb" : "#ffffff",
          end: dialog.end,
          layer: 5,
          rect: {
            height: rect.height - pixels(2),
            width: rect.width - pixels(2),
            x: rect.x + pixels(1),
            y: rect.y + pixels(1),
          },
          start: dialog.start,
        }),
      );
    }

    const textEvents = [
      assTextEvent({
        alignment: 7,
        color: "#111827",
        end: dialog.end,
        layer: 6,
        position: { x: panel.x + padding, y: titleY },
        start: dialog.start,
        style: "DialogTitle",
        text:
          annotation.type === "alert"
            ? "Alert"
            : annotation.type === "confirm"
              ? "Confirm"
              : "Prompt",
      }),
      assTextEvent({
        alignment: 7,
        color: "#111827",
        end: dialog.end,
        layer: 6,
        position: { x: panel.x + padding, y: messageY },
        start: dialog.start,
        style: "DialogBody",
        text: layout.messageLines.join("\n"),
      }),
    ];

    for (const action of ["dismiss", "accept"] as const) {
      const rect = layout.buttons[action];
      if (!rect) continue;
      textEvents.push(
        assTextEvent({
          alignment: 5,
          color: selectedAction === action ? "#ffffff" : "#111827",
          end: dialog.end,
          layer: 6,
          position: { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) },
          start: dialog.start,
          style: "DialogButton",
          text: action === "accept" ? "OK" : "Cancel",
        }),
      );
    }

    if (!layout.inputRect) {
      return [...shapeEvents, ...textEvents];
    }

    const inputClip = {
      height: layout.inputRect.height - pixels(8),
      width: layout.inputRect.width - pixels(18),
      x: layout.inputRect.x + pixels(9),
      y: layout.inputRect.y + pixels(4),
    };
    const inputPosition = {
      x: inputClip.x,
      y: layout.inputRect.y + pixels(8),
    };
    const initialText = annotation.defaultValue || "";
    const finalText = annotation.promptText === undefined ? initialText : annotation.promptText;

    if (dialog.phase === "decision" || finalText === initialText) {
      textEvents.push(
        assTextEvent({
          alignment: 7,
          clip: inputClip,
          color: "#111827",
          end: dialog.end,
          layer: 6,
          position: inputPosition,
          start: dialog.start,
          style: "DialogInput",
          text: finalText,
        }),
      );
      return [...shapeEvents, ...textEvents];
    }

    const graphemes = videoModeGraphemes(finalText);
    const revealStart = dialog.start + Math.min(120, (dialog.end - dialog.start) * 0.15);
    const revealEnd = Math.max(
      revealStart,
      dialog.end - Math.min(200, (dialog.end - dialog.start) * 0.2),
    );

    if (graphemes.length === 0) {
      textEvents.push(
        assTextEvent({
          alignment: 7,
          clip: inputClip,
          color: "#111827",
          end: revealStart,
          layer: 6,
          position: inputPosition,
          start: dialog.start,
          style: "DialogInput",
          text: initialText,
        }),
      );
      return [...shapeEvents, ...textEvents];
    }

    const states = [
      initialText,
      ...graphemes.map((_, index) => graphemes.slice(0, index + 1).join("")),
    ];

    for (let index = 0; index < states.length; index += 1) {
      const start =
        index === 0
          ? dialog.start
          : revealStart + ((revealEnd - revealStart) * (index - 1)) / graphemes.length;
      const end =
        index === states.length - 1
          ? dialog.end
          : revealStart + ((revealEnd - revealStart) * index) / graphemes.length;
      if (formatAssTime(start) === formatAssTime(end)) continue;
      textEvents.push(
        assTextEvent({
          alignment: 7,
          clip: inputClip,
          color: "#111827",
          end,
          layer: 6,
          position: inputPosition,
          start,
          style: "DialogInput",
          text: states[index],
        }),
      );
    }

    return [...shapeEvents, ...textEvents];
  });

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${options.video.width}`,
    `PlayResY: ${options.video.height}`,
    "ScaledBorderAndShadow: yes",
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: DialogShape,Arial,1,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1",
    `Style: DialogTitle,Arial,${pixels(17)},&H00182711,&H00182711,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: DialogBody,Arial,${pixels(15)},&H00182711,&H00182711,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: DialogInput,Arial,${pixels(15)},&H00182711,&H00182711,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: DialogButton,Arial,${pixels(14)},&H00182711,&H00182711,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
};

const assAnnotations = (options: {
  addressBars: VideoModeAddressBar[];
  captions: VideoModeCaption[];
  video: { height: number; width: number };
}) => {
  const { addressBars, captions, video } = options;
  const fontSize = Math.max(24, Math.round(video.height * 0.06));
  const margin = Math.max(24, Math.round(video.height * 0.06));
  const captionEvents = captions
    .map(
      (caption) =>
        `Dialogue: 0,${formatAssTime(caption.start)},${formatAssTime(caption.end)},Caption,,0,0,0,,${escapeAssText(caption.text)}`,
    )
    .join("\n");
  const addressBarHeight = Math.max(58, Math.round(video.height * 0.12));
  const pillX = Math.max(12, Math.round(video.width * 0.017));
  const pillY = Math.max(9, Math.round(addressBarHeight * 0.18));
  const pillWidth = video.width - pillX * 2;
  const pillHeight = addressBarHeight - pillY * 2;
  const addressFontSize = Math.max(12, Math.round(video.height * 0.024));
  const addressMarginLeft = pillX + Math.round(pillHeight * 0.42);
  const addressMarginTop = pillY + Math.round(pillHeight * 0.22);
  const addressClipRight = pillX + pillWidth - Math.round(pillHeight * 0.35);
  const addressEvents = addressBars
    .flatMap((addressBar) => {
      const start = formatAssTime(addressBar.start);
      const end = formatAssTime(addressBar.end);
      const duration = addressBar.end - addressBar.start;
      const revealStart = addressBar.start + Math.min(120, duration * 0.15);
      const revealEnd = Math.max(revealStart, addressBar.end - Math.min(200, duration * 0.2));
      const graphemes = videoModeGraphemes(addressBar.url);
      const addressTextStates = [""];
      for (const grapheme of graphemes) {
        addressTextStates.push(`${addressTextStates[addressTextStates.length - 1]}${grapheme}`);
      }
      const addressTextEvents = addressTextStates.flatMap((text, index, states) => {
        const textStart =
          index === 0
            ? addressBar.start
            : revealStart + ((revealEnd - revealStart) * (index - 1)) / graphemes.length;
        const textEnd =
          index === states.length - 1
            ? addressBar.end
            : revealStart + ((revealEnd - revealStart) * index) / graphemes.length;

        if (formatAssTime(textStart) === formatAssTime(textEnd)) {
          return [];
        }

        return [
          `Dialogue: 2,${formatAssTime(textStart)},${formatAssTime(textEnd)},Address,,0,0,0,,{\\q2\\clip(${addressMarginLeft},${pillY},${addressClipRight},${pillY + pillHeight})}●  ${escapeAssText(text)}`,
        ];
      });
      return [
        `Dialogue: 0,${start},${end},AddressShape,,0,0,0,,{\\an7\\pos(0,0)\\p1\\bord0\\shad0\\1c&H00343130&}m 0 0 l ${video.width} 0 l ${video.width} ${addressBarHeight} l 0 ${addressBarHeight}`,
        `Dialogue: 1,${start},${end},AddressShape,,0,0,0,,{\\an7\\pos(0,0)\\p1\\bord0\\shad0\\1c&H0068635F&}m ${pillX} ${pillY} l ${pillX + pillWidth} ${pillY} l ${pillX + pillWidth} ${pillY + pillHeight} l ${pillX} ${pillY + pillHeight}`,
        ...addressTextEvents,
      ];
    })
    .join("\n");
  const events = [captionEvents, addressEvents].filter(Boolean).join("\n");

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
    "Style: AddressShape,Arial,1,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1",
    `Style: Address,Arial,${addressFontSize},&H00F8F9FA,&H00F8F9FA,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,${addressMarginLeft},0,${addressMarginTop},1`,
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
  addressBars: VideoModeAddressBar[];
  frameDurationMs: number;
  highlights: VideoModeHighlight[];
  preActionStabilizationMs: number;
  segments: RenderVideoSegment[];
}): VideoPiece[] => {
  const pieces: VideoPiece[] = [];

  for (const segment of options.segments) {
    let cursor = segment.start;
    let previousHighlight: VideoModeHighlight | undefined;
    const highlights = options.highlights.filter(
      (highlight) => highlight.start >= segment.start && highlight.start < segment.end,
    );
    const addressBars = options.addressBars.filter(
      (addressBar) => addressBar.start >= segment.start && addressBar.start < segment.end,
    );
    const annotations = [
      ...highlights.map((highlight) => ({ highlight, start: highlight.start })),
      ...addressBars.map((addressBar) => ({ addressBar, start: addressBar.start })),
    ].sort(
      (left, right) =>
        left.start - right.start || Number("highlight" in left) - Number("highlight" in right),
    );

    for (const annotation of annotations) {
      if ("addressBar" in annotation) {
        const { addressBar } = annotation;
        if (addressBar.start > cursor) {
          pieces.push({ end: addressBar.start, speed: segment.speed, start: cursor });
        }

        pieces.push({
          addressBar,
          end: Math.min(
            segment.end,
            addressBar.start + options.frameDurationMs,
          ),
          speed: 1,
          start: addressBar.start,
        });
        cursor = Math.max(cursor, addressBar.start);
        continue;
      }

      const highlight = annotation.highlight;
      const highlightIndex = highlights.indexOf(highlight);
      const nextHighlight = highlights[highlightIndex + 1];

      if (highlight.start > cursor) {
        const postAction = previousHighlight?.fillReveal ? previousHighlight : undefined;
        const preAction = highlight.fillReveal ? highlight : undefined;
        // `trim` chooses whole source frames. Round down so the boundary frame
        // belongs to the stabilized piece instead of leaking from the raw gap.
        const preActionStart = preAction
          ? Math.max(
              cursor,
              Math.floor(
                (highlight.start - options.preActionStabilizationMs) /
                  options.frameDurationMs,
              ) * options.frameDurationMs,
            )
          : highlight.start;

        if (preActionStart > cursor) {
          pieces.push({
            end: preActionStart,
            postAction,
            speed: segment.speed,
            start: cursor,
          });
        }

        if (highlight.start > preActionStart) {
          pieces.push({
            end: highlight.start,
            postAction,
            preAction,
            speed: segment.speed,
            start: preActionStart,
          });
        }
      }

      const actionEnd =
        highlight.actionEnd === undefined
          ? highlight.start + options.frameDurationMs
          : Math.max(highlight.start, highlight.actionEnd);
      const highlightSourceEnd = Math.min(
        segment.end,
        Math.max(highlight.start + 1, actionEnd),
      );

      if (highlightSourceEnd > highlight.start) {
        pieces.push({
          end: highlightSourceEnd,
          highlight,
          speed: segment.speed,
          start: highlight.start,
        });
      }

      let nextCursor = actionEnd;

      if (nextHighlight && highlight.end > nextHighlight.start) {
        nextCursor = Math.max(nextCursor, nextHighlight.start);
      }

      cursor = Math.min(segment.end, nextCursor);
      previousHighlight = highlight;
    }

    if (segment.end > cursor) {
      pieces.push({
        end: segment.end,
        postAction: previousHighlight?.fillReveal ? previousHighlight : undefined,
        speed: segment.speed,
        start: cursor,
      });
    }
  }

  const kept = pieces.filter((piece) => piece.end > piece.start);

  // Hand adjacent pans over to each other instead of yo-yoing: a return pan
  // directly followed by another pan skips its travel back, and the next pan
  // enters from the previous destination (a zero-length entry when both point
  // at the same view, so the hold simply continues).
  for (let index = 0; index < kept.length - 1; index += 1) {
    const current = kept[index];
    const next = kept[index + 1];
    const currentPan = current.highlight?.pan;
    const nextPan = next.highlight?.pan;

    if (
      !currentPan?.back ||
      !nextPan ||
      current.highlight === next.highlight ||
      next.highlight!.start > current.end + options.frameDurationMs
    ) {
      continue;
    }

    const viewport = current.highlight!.viewport;
    const nextImageCoversCurrentDestination =
      currentPan.to.x >= nextPan.imageRect.x &&
      currentPan.to.y >= nextPan.imageRect.y &&
      currentPan.to.x + viewport.width <= nextPan.imageRect.x + nextPan.imageRect.width &&
      currentPan.to.y + viewport.height <= nextPan.imageRect.y + nextPan.imageRect.height;

    if (!nextImageCoversCurrentDestination) {
      continue;
    }

    const distance = Math.hypot(
      nextPan.to.x - currentPan.to.x,
      nextPan.to.y - currentPan.to.y,
    );
    current.panBackSuppressed = true;
    next.panEntry = {
      durationMs: distance < 1 ? 0 : panDurationMs(currentPan.to, nextPan.to),
      from: currentPan.to,
    };
  }

  return kept;
};

const scaleVideoModeRect = (
  rect: VideoModeRect,
  viewport: VideoModeViewport,
  video: { width: number; height: number },
) => {
  const scale = Math.min(
    video.width / viewport.width,
    video.height / viewport.height,
  );
  const x = Math.max(0, Math.round(rect.x * scale));
  const y = Math.max(0, Math.round(rect.y * scale));
  const width = Math.max(1, Math.round(rect.width * scale));
  const height = Math.max(1, Math.round(rect.height * scale));

  return {
    height: Math.min(height, Math.max(1, video.height - y)),
    width: Math.min(width, Math.max(1, video.width - x)),
    x,
    y,
  };
};

const scaleHighlight = (highlight: VideoModeHighlight, video: { width: number; height: number }) => {
  return scaleVideoModeRect(highlight.rect, highlight.viewport, video);
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

const drawboxFilterForRect = (
  highlight: VideoModeHighlight,
  rect: VideoModeRect,
  video: { width: number; height: number },
) => {
  const scaledRect = scaleVideoModeRect(rect, highlight.viewport, video);
  return [
    `drawbox=x=${scaledRect.x}`,
    `y=${scaledRect.y}`,
    `w=${scaledRect.width}`,
    `h=${scaledRect.height}`,
    `color=${highlight.color}`,
    `t=${Math.max(1, Math.round(highlight.thickness))}`,
  ].join(":");
};

const drawboxFilter = (highlight: VideoModeHighlight, video: { width: number; height: number }) =>
  drawboxFilterForRect(highlight, highlight.rect, video);

const renderedPieceDuration = (piece: VideoPiece) => {
  if (piece.addressBar) {
    return piece.addressBar.end - piece.addressBar.start;
  }

  const sourceDuration = (piece.end - piece.start) / piece.speed;

  if (!piece.highlight) {
    return sourceDuration;
  }

  const highlightDuration = piece.highlight.end - piece.highlight.start;

  if (piece.highlight.pan) {
    const entryMs = piece.panEntry ? piece.panEntry.durationMs : piece.highlight.pan.durationMs;
    const backMs =
      piece.highlight.pan.back && !piece.panBackSuppressed ? piece.highlight.pan.durationMs : 0;
    return highlightDuration + entryMs + backMs;
  }

  if (piece.highlight.image || piece.highlight.dialog) {
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
      const fillsSyntheticHold =
        (piece.highlight !== undefined &&
          caption.start <= piece.highlight.start &&
          caption.end >= piece.highlight.start) ||
        (piece.addressBar !== undefined &&
          caption.start <= piece.addressBar.start &&
          caption.end >= piece.addressBar.start);

      if ((!overlap && !fillsSyntheticHold) || !Number.isFinite(piece.speed)) {
        return [];
      }

      const start = overlap
        ? piece.outputStart + (overlap.start - piece.start) / piece.speed
        : piece.outputStart;
      const end = fillsSyntheticHold
        ? piece.outputEnd
        : piece.outputStart + (overlap!.end - piece.start) / piece.speed;

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

const projectVideoAddressBars = (pieces: RenderedVideoPiece[]) => {
  return pieces.flatMap((piece) =>
    piece.addressBar
      ? [
          {
            end: Math.round(piece.outputEnd),
            start: Math.round(piece.outputStart),
            url: piece.addressBar.url,
          },
        ]
      : [],
  );
};

const projectVideoDialogs = (pieces: RenderedVideoPiece[]): RenderedVideoDialog[] => {
  return pieces.flatMap((piece) => {
    if (!piece.highlight?.dialog) {
      return [];
    }

    return [
      {
        annotation: piece.highlight.dialog,
        end: Math.round(piece.outputEnd),
        phase: piece.highlight.method === "fill" ? "fill" : "decision",
        start: Math.round(piece.outputStart),
        viewport: piece.highlight.viewport,
      },
    ];
  });
};

const highlightCursorPoint = (
  highlight: VideoModeHighlight,
  video: { width: number; height: number },
) => {
  const rect = highlight.fillReveal
    ? scaleVideoModeRect(highlight.fillReveal.initialRect, highlight.viewport, video)
    : scaleHighlight(highlight, video);

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

    // A panning piece only shows the element at its held rect between the pan
    // in and the pan back, so aim the cursor at that window.
    const panLeadMs = highlight.pan
      ? piece.panEntry
        ? piece.panEntry.durationMs
        : highlight.pan.durationMs
      : 0;
    const panTailMs =
      highlight.pan?.back && !piece.panBackSuppressed ? highlight.pan.durationMs : 0;
    targets.push({
      highlight,
      method: highlight.method,
      outputEnd: piece.outputEnd - panTailMs,
      outputStart: piece.outputStart + panLeadMs,
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
  addressBars: VideoModeAddressBar[];
  captionFile?: string;
  clickPointerInput?: PointerInput;
  cursorPointerInput?: PointerInput;
  dialogFile?: string;
  dialogPostFrameInput: StillFrameInput | undefined;
  dialogPostHoldMs: number;
  finalFrameInput: StillFrameInput | undefined;
  finalHoldMs: number;
  highlightMode: "outline" | "pointer";
  highlightInputs: HighlightInput[];
  highlights: VideoModeHighlight[];
  preActionStabilizationMs: number;
  segments: RenderVideoSegment[];
  textPointerInput?: PointerInput;
  video: { frameDurationMs: number; width: number; height: number };
}): VideoFilter | undefined => {
  const highlightInputByImage = new Map(
    options.highlightInputs.map((input) => [input.image, input]),
  );
  const pieces = videoPieces({
    addressBars: options.addressBars,
    frameDurationMs: options.video.frameDurationMs,
    highlights: options.highlights,
    preActionStabilizationMs: options.preActionStabilizationMs,
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
    const renderedPiece = renderedPieces[index];
    const label = `render${index}`;
    labels.push(`[${label}]`);

    const operations: string[] = [];
    const preActionInput = piece.preAction?.image
      ? highlightInputByImage.get(piece.preAction.image)
      : undefined;
    const postActionInput = piece.postAction?.fillReveal
      ? highlightInputByImage.get(piece.postAction.fillReveal.image)
      : undefined;
    const fillReveal = piece.highlight?.fillReveal;
    const preFillInput = piece.highlight?.image
      ? highlightInputByImage.get(piece.highlight.image)
      : undefined;
    const postFillInput = fillReveal
      ? highlightInputByImage.get(fillReveal.image)
      : undefined;

    const stabilizations: {
      input: HighlightInput;
      rect: VideoModeRect;
      viewport: VideoModeViewport;
    }[] = [];

    if (piece.highlight?.dialog) {
      const duration = renderedPieceDuration(piece);
      const sourceFrameStart = Math.max(
        0,
        (piece.highlight.sourceFrameAt || piece.highlight.start) - options.video.frameDurationMs,
      );
      operations.push(
        `[0:v]trim=start=${formatSeconds(sourceFrameStart)}:end=${formatSeconds(
          sourceFrameStart + options.video.frameDurationMs,
        )}`,
      );
      operations.push("setpts=PTS-STARTPTS");
      operations.push(
        `tpad=stop_mode=clone:stop_duration=${formatSeconds(
          Math.max(0, duration - options.video.frameDurationMs),
        )}`,
      );
      operations.push(`trim=start=0:end=${formatSeconds(duration)}`);
      filters.push(`${operations.join(",")}[${label}]`);
      continue;
    }

    // Screencasts can have no frame packet inside these short calibrated
    // slices. Use the exact action screenshot as the whole boundary frame so
    // a target crop can never be composited over FFmpeg's empty black canvas.
    const boundaryFrame =
      piece.preAction && preActionInput
        ? {
            input: preActionInput,
            viewport: piece.preAction.viewport,
          }
        : index === pieces.length - 1 && piece.postAction?.fillReveal && postActionInput
          ? {
              input: postActionInput,
              viewport: piece.postAction.viewport,
            }
          : undefined;
    if (boundaryFrame) {
      const scaledViewport = scaledViewportSize(boundaryFrame.viewport, options.video);
      filters.push(
        [
          `[${boundaryFrame.input.inputIndex}:v]scale=w=${scaledViewport.width}:h=${scaledViewport.height}`,
          `pad=w=${options.video.width}:h=${options.video.height}:x=0:y=0:color=gray`,
          `trim=start=0:end=${formatSeconds(renderedPieceDuration(piece))}`,
          `setpts=PTS-STARTPTS[${label}]`,
        ].join(","),
      );
      continue;
    }

    if (piece.postAction?.fillReveal && postActionInput) {
      stabilizations.push({
        input: postActionInput,
        rect: piece.postAction.rect,
        viewport: piece.postAction.viewport,
      });
    }

    if (stabilizations.length > 0) {
      const durationSeconds = formatSeconds(renderedPieceDuration(piece));
      const baseLabel = `stabilizebase${index}`;
      filters.push(
        [
          `[0:v]trim=start=${formatSeconds(piece.start)}:end=${formatSeconds(piece.end)}`,
          `setpts=(PTS-STARTPTS)/${formatFilterNumber(piece.speed)}`,
        ]
          .filter((operation): operation is string => Boolean(operation))
          .join(",") + `[${baseLabel}]`,
      );

      let composedLabel = baseLabel;
      for (let stabilizationIndex = 0; stabilizationIndex < stabilizations.length; stabilizationIndex += 1) {
        const stabilization = stabilizations[stabilizationIndex];
        const scaledViewport = scaledViewportSize(stabilization.viewport, options.video);
        const rect = scaleVideoModeRect(
          stabilization.rect,
          stabilization.viewport,
          options.video,
        );
        const cropLabel = `stabilizecrop${index}x${stabilizationIndex}`;
        const nextLabel =
          stabilizationIndex === stabilizations.length - 1
            ? label
            : `stabilized${index}x${stabilizationIndex}`;
        filters.push(
          [
            `[${stabilization.input.inputIndex}:v]scale=w=${scaledViewport.width}:h=${scaledViewport.height}`,
            `pad=w=${options.video.width}:h=${options.video.height}:x=0:y=0:color=gray`,
            `crop=w=${rect.width}:h=${rect.height}:x=${rect.x}:y=${rect.y}`,
            `trim=start=0:end=${durationSeconds}`,
            `setpts=PTS-STARTPTS[${cropLabel}]`,
          ].join(","),
        );
        filters.push(
          [
            `[${composedLabel}][${cropLabel}]overlay=x=${rect.x}`,
            `y=${rect.y}`,
            `shortest=1[${nextLabel}]`,
          ].join(":"),
        );
        composedLabel = nextLabel;
      }
      continue;
    }

    if (piece.highlight && fillReveal && preFillInput && postFillInput) {
      const scaledViewport = scaledViewportSize(piece.highlight.viewport, options.video);
      const contentRect = scaleVideoModeRect(
        fillReveal.contentRect,
        piece.highlight.viewport,
        options.video,
      );
      const duration = renderedPieceDuration(piece);
      const durationSeconds = formatSeconds(duration);
      const coverRect = fillReveal.cover
        ? scaleVideoModeRect(fillReveal.cover.rect, piece.highlight.viewport, options.video)
        : undefined;
      const initialRect = scaleVideoModeRect(
        fillReveal.initialRect,
        piece.highlight.viewport,
        options.video,
      );
      const finalRect = scaleHighlight(piece.highlight, options.video);
      const geometryChanged =
        initialRect.height !== finalRect.height ||
        initialRect.width !== finalRect.width ||
        initialRect.x !== finalRect.x ||
        initialRect.y !== finalRect.y;
      const scale = Math.min(
        options.video.width / piece.highlight.viewport.width,
        options.video.height / piece.highlight.viewport.height,
      );
      const revealStops = fillReveal.revealStops
        .map((stop) => Math.max(1, Math.min(contentRect.width, Math.round(stop * scale))))
        .filter((stop, stopIndex, stops) => stopIndex === 0 || stop !== stops[stopIndex - 1]);
      const revealSteps = fillReveal.revealBands.flatMap((band) => {
        const y = Math.max(0, Math.min(contentRect.height - 1, Math.round(band.y * scale)));
        const height = Math.max(
          1,
          Math.min(contentRect.height - y, Math.round(band.height * scale)),
        );
        return revealStops.map((width) => ({ height, width, y }));
      });
      const target = plan.targets.find(
        (candidate) => candidate.highlight === piece.highlight,
      );
      const revealEnd =
        options.highlightMode === "pointer"
          ? Math.max(0, duration - TEXT_CURSOR_POINTER_TAIL_MS)
          : duration;
      const pointerArrival = target
        ? Math.max(0, target.arriveAt - renderedPiece.outputStart)
        : 0;
      const availableAfterArrival = Math.max(0, revealEnd - pointerArrival);
      const preRevealHold = Math.min(
        TEXT_CURSOR_HOLD_IDEAL_MS,
        availableAfterArrival / 2,
      );
      const revealStart = Math.max(
        0,
        Math.min(revealEnd, pointerArrival + preRevealHold),
      );
      const baseLabel = `fillbase${index}`;
      const splitLabels = revealSteps.map((_, stepIndex) => `fillpost${index}x${stepIndex}`);

      filters.push(
        [
          `[${preFillInput.inputIndex}:v]scale=w=${scaledViewport.width}:h=${scaledViewport.height}`,
          `pad=w=${options.video.width}:h=${options.video.height}:x=0:y=0:color=gray`,
          geometryChanged && fillReveal.cover
            ? `drawbox=x=${initialRect.x}:y=${initialRect.y}:w=${initialRect.width}:h=${initialRect.height}:color=${fillReveal.cover.color}:t=fill`
            : undefined,
          coverRect && fillReveal.cover
            ? `drawbox=x=${coverRect.x}:y=${coverRect.y}:w=${coverRect.width}:h=${coverRect.height}:color=${fillReveal.cover.color}:t=fill${geometryChanged ? `:enable='gte(t\\,${formatSeconds(revealStart)})'` : ""}`
            : undefined,
          `trim=start=0:end=${durationSeconds}`,
          `setpts=PTS-STARTPTS[${baseLabel}]`,
        ]
          .filter((operation): operation is string => Boolean(operation))
          .join(","),
      );
      filters.push(
        [
          `[${postFillInput.inputIndex}:v]scale=w=${scaledViewport.width}:h=${scaledViewport.height}`,
          `pad=w=${options.video.width}:h=${options.video.height}:x=0:y=0:color=gray`,
          `crop=w=${contentRect.width}:h=${contentRect.height}:x=${contentRect.x}:y=${contentRect.y}`,
          `trim=start=0:end=${durationSeconds}`,
          "setpts=PTS-STARTPTS",
          `split=${revealSteps.length}${splitLabels.map((splitLabel) => `[${splitLabel}]`).join("")}`,
        ].join(","),
      );

      let composedLabel = baseLabel;
      for (let stepIndex = 0; stepIndex < revealSteps.length; stepIndex += 1) {
        const step = revealSteps[stepIndex];
        const cropLabel = `fillcrop${index}x${stepIndex}`;
        const nextLabel = `fillcomposed${index}x${stepIndex}`;
        const showAt =
          revealStart +
          ((revealEnd - revealStart) * (stepIndex + 1)) /
            (revealSteps.length + 1);
        filters.push(
          `${[
            `[${splitLabels[stepIndex]}]crop=w=${step.width}`,
            `h=${step.height}`,
            "x=0",
            `y=${step.y}`,
          ].join(":")}[${cropLabel}]`,
        );
        filters.push(
          [
            `[${composedLabel}][${cropLabel}]overlay=x=${contentRect.x}`,
            `y=${contentRect.y + step.y}`,
            `enable='gte(t\\,${formatSeconds(showAt)})'`,
            `shortest=1[${nextLabel}]`,
          ].join(":"),
        );
        composedLabel = nextLabel;
      }

      if (options.highlightMode === "outline" && geometryChanged) {
        filters.push(
          [
            `[${composedLabel}]${drawboxFilterForRect(piece.highlight, fillReveal.initialRect, options.video)}:enable='lt(t\\,${formatSeconds(revealStart)})'`,
            `${drawboxFilter(piece.highlight, options.video)}:enable='gte(t\\,${formatSeconds(revealStart)})'[${label}]`,
          ].join(","),
        );
      } else {
        filters.push(
          options.highlightMode === "outline"
            ? `[${composedLabel}]${drawboxFilter(piece.highlight, options.video)}[${label}]`
            : `[${composedLabel}]null[${label}]`,
        );
      }
      continue;
    }

    if (
      piece.highlight?.pan &&
      piece.highlight.image &&
      highlightInputByImage.has(piece.highlight.image)
    ) {
      const highlight = piece.highlight;
      const pan = piece.highlight.pan;
      const input = highlightInputByImage.get(piece.highlight.image)!;
      const scale = Math.min(
        options.video.width / highlight.viewport.width,
        options.video.height / highlight.viewport.height,
      );
      const scaledViewport = scaledViewportSize(highlight.viewport, options.video);
      const scaledImage = {
        height: Math.max(scaledViewport.height, Math.round(pan.imageRect.height * scale)),
        width: Math.max(scaledViewport.width, Math.round(pan.imageRect.width * scale)),
      };
      const cropOffset = (scroll: { x: number; y: number }) => ({
        x: Math.max(
          0,
          Math.min(
            Math.round((scroll.x - pan.imageRect.x) * scale),
            scaledImage.width - scaledViewport.width,
          ),
        ),
        y: Math.max(
          0,
          Math.min(
            Math.round((scroll.y - pan.imageRect.y) * scale),
            scaledImage.height - scaledViewport.height,
          ),
        ),
      });
      const from = cropOffset(piece.panEntry ? piece.panEntry.from : pan.from);
      const to = cropOffset(pan.to);
      const duration = renderedPieceDuration(piece);
      const entryMs = piece.panEntry ? piece.panEntry.durationMs : pan.durationMs;
      const panBack = pan.back && !piece.panBackSuppressed;
      const holdEndMs = entryMs + (highlight.end - highlight.start);
      const travel = (startMs: number, legMs: number, a: number, b: number) =>
        legMs <= 0
          ? `${b}`
          : `(${a}+(${b - a})*(1-cos(PI*clip((t-${formatSeconds(startMs)})/${formatSeconds(
              legMs,
            )},0,1)))/2)`;
      const axisExpression = (a: number, b: number) => {
        const expression = panBack
          ? `if(lt(t,${formatSeconds(holdEndMs)}),${travel(0, entryMs, a, b)},${travel(holdEndMs, pan.durationMs, b, a)})`
          : travel(0, entryMs, a, b);
        return `'${expression.replaceAll(",", "\\,")}'`;
      };
      const highlightEnable = panBack
        ? `between(t\\,${formatSeconds(entryMs)}\\,${formatSeconds(holdEndMs)})`
        : `gte(t\\,${formatSeconds(entryMs)})`;
      operations.push(
        `[${input.inputIndex}:v]scale=w=${scaledImage.width}:h=${scaledImage.height}`,
      );
      operations.push(
        `crop=w=${scaledViewport.width}:h=${scaledViewport.height}:x=${axisExpression(from.x, to.x)}:y=${axisExpression(from.y, to.y)}`,
      );
      operations.push(
        `pad=w=${options.video.width}:h=${options.video.height}:x=0:y=0:color=gray`,
      );
      if (options.highlightMode === "outline") {
        operations.push(`${drawboxFilter(highlight, options.video)}:enable='${highlightEnable}'`);
      }
      operations.push(`trim=start=0:end=${formatSeconds(duration)}`);
      operations.push("setpts=PTS-STARTPTS");
      filters.push(`${operations.join(",")}[${label}]`);
      continue;
    }

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

    if (piece.addressBar) {
      operations.push(
        `tpad=stop_mode=clone:stop_duration=${formatSeconds(
          Math.max(
            0,
            piece.addressBar.end - piece.addressBar.start - (piece.end - piece.start),
          ),
        )}`,
      );
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

  if (remainingFinalHoldMs > 0 && options.finalFrameInput) {
    const scaledViewport = scaledViewportSize(
      options.finalFrameInput.viewport,
      options.video,
    );
    filters.push(
      [
        `[${options.finalFrameInput.inputIndex}:v]scale=w=${scaledViewport.width}:h=${scaledViewport.height}`,
        `pad=w=${options.video.width}:h=${options.video.height}:x=0:y=0:color=gray`,
        `trim=start=0:end=${formatSeconds(remainingFinalHoldMs)}`,
        "setpts=PTS-STARTPTS[finalhold]",
      ].join(","),
    );
    filters.push(`[${concatLabel}][finalhold]concat=n=2:v=1:a=0[renderfinalhold]`);
    concatLabel = "renderfinalhold";
    remainingFinalHoldMs = 0;
  }

  const outputLabel = remainingFinalHoldMs > 0 ? "renderout" : concatLabel;

  if (remainingFinalHoldMs > 0) {
    filters.push(
      `[${concatLabel}]tpad=stop_mode=clone:stop_duration=${formatSeconds(remainingFinalHoldMs)}[${outputLabel}]`,
    );
  }

  let dialogOutputLabel = outputLabel;

  if (options.dialogFile) {
    filters.push(
      `[${outputLabel}]ass=${escapeFfmpegFilterValue(options.dialogFile)}[renderdialogs]`,
    );
    dialogOutputLabel = "renderdialogs";
  }

  let annotatedOutputLabel = dialogOutputLabel;

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
        inputLabel: dialogOutputLabel,
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
      "format=duration:stream=width,height,avg_frame_rate",
      "-of",
      "json",
      path,
    ],
    { maxBuffer: 1024 * 1024 },
  );
  const payload = JSON.parse(stdout);
  const seconds = Number(payload.format?.duration);
  const stream = payload.streams?.find((candidate: any) => candidate.width && candidate.height);
  const [frameRateNumerator, frameRateDenominator] = String(stream?.avg_frame_rate)
    .split("/")
    .map(Number);
  const frameRate = frameRateNumerator / frameRateDenominator;

  if (
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    !stream ||
    !Number.isFinite(frameRate) ||
    frameRate <= 0
  ) {
    throw new Error(`Could not read video duration from ffprobe output: ${stdout}`);
  }

  return {
    durationMs: Math.round(seconds * 1000),
    frameDurationMs: 1000 / frameRate,
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

const settleVideoRecorder = async (page: Page) => {
  // This frame is deliberately outside the render range. It gives Playwright a
  // final compositor update, then remains unchanged long enough for the raw
  // endpoint and videoMode's close timestamp to describe the same instant.
  await page.evaluate(() => {
    const cover = document.createElement("div");
    cover.setAttribute("data-middlewright-video-mode-calibration", "");
    Object.assign(cover.style, {
      background: "rgb(1, 2, 3)",
      inset: "0",
      position: "fixed",
      zIndex: "2147483647",
    });
    (document.body || document.documentElement).append(cover);
  });
  await page.screenshot({ scale: "css" });
  await new Promise((resolve) => setTimeout(resolve, VIDEO_MODE_RECORDER_SETTLE_MS));
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
  addressBars: VideoModeAddressBar[];
  captions: VideoModeCaption[];
  dialogPostFrame: { path: string; viewport: VideoModeViewport } | undefined;
  dialogPostHoldMs: number;
  finalFrame: { path: string; viewport: VideoModeViewport } | undefined;
  finalHoldMs: number;
  highlightMode: "outline" | "pointer";
  highlights: VideoModeHighlight[];
  inputPath: string;
  outputDir: string;
  outputPath: string;
  deadAir: VideoModeSpan[];
  sourceRange: VideoModeSourceRange;
  thresholdMs: number | undefined;
  timelineOffsetMs: number;
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
  // Highlight times have already moved forward by `timelineOffsetMs`, while
  // the live completed fill can enter the raw recorder at its original action
  // time. Stabilize that measured gap plus enough source/concat frame padding
  // to keep the last completed raw frame behind the synthetic reveal.
  const preActionStabilizationMs =
    Math.max(0, options.timelineOffsetMs) +
    info.frameDurationMs * VIDEO_MODE_FILL_PRE_ACTION_FRAME_PADDING;

  if (rangeEnd <= rangeStart) {
    console.warn(
      `videoMode source range is empty: start ${rangeStart}ms must be before end ${rangeEnd}ms`,
    );
    return false;
  }

  const highlightInputs = options.highlights
    .flatMap((highlight) => {
      const images = [
        highlight.image,
        highlight.fillReveal?.image,
      ].filter((image): image is string => Boolean(image));
      return images.map((image) => ({ image }));
    })
    .map((input, index) => ({
      ...input,
      inputIndex: index + 1,
      path: join(options.outputDir, input.image),
    }));
  const dialogPostFrameInput: StillFrameInput | undefined = options.dialogPostFrame
    ? {
        inputIndex: highlightInputs.length + 1,
        path: options.dialogPostFrame.path,
        viewport: options.dialogPostFrame.viewport,
      }
    : undefined;
  const finalFrameInput: StillFrameInput | undefined = options.finalFrame
    ? {
        inputIndex: highlightInputs.length + (dialogPostFrameInput ? 2 : 1),
        path: options.finalFrame.path,
        viewport: options.finalFrame.viewport,
      }
    : undefined;
  const pointerInputOffset =
    highlightInputs.length + (dialogPostFrameInput ? 1 : 0) + (finalFrameInput ? 1 : 0);
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
  const renderedPieces = renderedVideoPieces(
    videoPieces({
      addressBars: options.addressBars,
      frameDurationMs: info.frameDurationMs,
      highlights: options.highlights,
      preActionStabilizationMs,
      segments,
    }),
  );
  const renderedAddressBars = projectVideoAddressBars(renderedPieces);
  const renderedDialogs = projectVideoDialogs(renderedPieces);
  const renderedCaptions = projectVideoCaptions(
    options.captions,
    renderedPieces,
  );
  const captionFile =
    renderedAddressBars.length > 0 || renderedCaptions.length > 0
      ? join(options.outputDir, VIDEO_MODE_CAPTIONS_FILE)
      : undefined;

  if (captionFile) {
    await writeFile(
      captionFile,
      assAnnotations({
        addressBars: renderedAddressBars,
        captions: renderedCaptions,
        video: info,
      }),
    );
  }
  const dialogFile =
    renderedDialogs.length > 0 ? join(options.outputDir, VIDEO_MODE_DIALOGS_FILE) : undefined;

  if (dialogFile) {
    await writeFile(
      dialogFile,
      assDialogAnnotations({
        dialogs: renderedDialogs,
        video: info,
      }),
    );
  }

  const filter = renderedVideoFilter({
    addressBars: options.addressBars,
    captionFile,
    clickPointerInput,
    cursorPointerInput,
    dialogFile,
    dialogPostFrameInput,
    dialogPostHoldMs: options.dialogPostHoldMs,
    finalFrameInput,
    finalHoldMs: options.finalHoldMs,
    highlightMode: options.highlightMode,
    highlightInputs,
    highlights: options.highlights,
    preActionStabilizationMs,
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
      // Boundary slices can outlast the configured highlight hold. Every
      // still-image consumer trims itself to its rendered piece.
      ...highlightInputs.flatMap((input) => ["-loop", "1", "-i", input.path]),
      ...(dialogPostFrameInput
        ? ["-loop", "1", "-i", dialogPostFrameInput.path]
        : []),
      ...(finalFrameInput ? ["-loop", "1", "-i", finalFrameInput.path] : []),
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
        addressBars: [],
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
    defaultValue: 1000,
    name: "videoMode finalHold",
    value: options.finalHold,
  });
  const addressBar = resolveAddressBar(options.addressBar);
  const captionMode = options.captions || "test-step";
  const highlight = resolveVideoModeHighlight(options);
  const skipMethods = options.skipMethods || [];
  const skipStackFrames = options.skipStackFrames || [];
  const deadAirThreshold = resolveDeadAirThreshold(options.deadAirThreshold);
  const trimStart = resolveTrimStart(options.trimStart);
  const state: VideoModeState = {
    addressBars: [],
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

      if (
        trimStart.firstLocator &&
        state.sourceRange.start === undefined &&
        state.startedAt !== undefined
      ) {
        controls.setStartTime(Math.max(0, Math.round(timing.actionStartedAt - state.startedAt)));
      }

      if (method === "waitFor") {
        let result: unknown;
        try {
          result = await next();
        } finally {
          recordActionElapsedDeadAirFromTiming(state, timing, { minimumMs: 0 });
        }

        if (highlight.mode !== "off" && !skipMethods.includes(method)) {
          await recordHighlight({
            pan: "return",
            color: highlight.color,
            durationMs: highlight.durationMs,
            locator,
            method,
            requireVisible: true,
            startAfterScreenshot: true,
            state,
            testInfo,
            thickness: highlight.thickness,
          });
        }

        return result;
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
              pan: method === "fill" ? "off" : "stay",
              color: highlight.color,
              durationMs: highlight.durationMs,
              locator,
              method,
              requireVisible: false,
              startAfterScreenshot: false,
              state,
              testInfo,
              thickness: highlight.thickness,
            });

      try {
        const result = await next();
        if (
          recordedHighlight &&
          method === "fill" &&
          typeof args[0] === "string" &&
          args[0].length > 0
        ) {
          await recordFillReveal({
            highlight: recordedHighlight,
            locator,
            state,
            testInfo,
          });
        }
        if (recordedHighlight && state.startedAt !== undefined) {
          recordedHighlight.actionEnd = Math.max(
            recordedHighlight.start,
            Math.round(performance.now() - state.startedAt),
          );
        }
        if (recordedHighlight?.pan) {
          await finalizePanHighlightAfterAction({
            highlight: recordedHighlight,
            locator,
            state,
          });
        }
        return result;
      } finally {
        if (recordedHighlight && state.startedAt !== undefined) {
          recordedHighlight.actionEnd =
            recordedHighlight.actionEnd ||
            Math.max(
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
      let addressBarOriginalGoto: Page["goto"] | undefined;
      let addressBarPage: Page | undefined;
      let addressBarGoto: Page["goto"] | undefined;
      let dialogPage: Page | undefined;
      let onDialog: ((dialog: Dialog) => void) | undefined;
      let stopObservingPlaywrightSteps = () => {};
      const offBeforeTest = emitter.on("beforeTest", async ({ page, testInfo }) => {
        dialogHighlightQueue = Promise.resolve();
        state.addressBars = [];
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

        if (addressBar) {
          const originalGoto = page.goto;
          const goto: Page["goto"] = async (url, gotoOptions) => {
            const response = await originalGoto.call(page, url, gotoOptions);
            const start = getVideoTimestamp();
            state.addressBars.push({
              end: start + addressBar.holdMs,
              start,
              url: page.url(),
            });
            return response;
          };
          addressBarOriginalGoto = originalGoto;
          addressBarPage = page;
          addressBarGoto = goto;
          Object.assign(page, { goto });
        }

        if (highlight.mode !== "off") {
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

            const openedAt = getVideoTimestamp();
            const viewport = page.viewportSize();
            if (!viewport) {
              throw new Error("videoMode cannot render a dialog without a viewport");
            }
            const defaultValue = dialog.defaultValue();
            const message = dialog.message();
            const type = dialog.type() as VideoModeDialogAnnotation["type"];
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
                  defaultValue,
                  durationMs: highlight.durationMs,
                  message,
                  openedAt,
                  promptText,
                  state,
                  thickness: highlight.thickness,
                  type,
                  viewport,
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
          const trimStartLocator = page
            .locator(trimStart.selector)
            .first() as LocatorWithOriginal;
          trimStartLocator
            .waitFor_original({ state: "visible", timeout: TRIM_START_SELECTOR_TIMEOUT_MS })
            .then(() => {
              if (state.sourceRange.start === undefined) controls.setStartTime();
            })
            .catch(() => {});
        }
      });

      const offAfterTestFinalize = emitter.on("afterTestFinalize", async ({ page, testInfo }) => {
        await Promise.all(pendingDialogHighlights);
        const renderEndedAt = getVideoTimestamp();
        const metadataBeforeVideo = metadataFor(state);
        const addressBars = metadataBeforeVideo.addressBars;
        const captions = metadataBeforeVideo.captions;
        const deadAir = metadataBeforeVideo.deadAir;
        const highlights = metadataBeforeVideo.highlights;
        const naturalPostDialogMs =
          state.lastDialogEndedAt === undefined
            ? 0
            : renderVideoSegments({
                deadAir,
                finalEnd: renderEndedAt,
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
          let finalFrame: { path: string; viewport: VideoModeViewport } | undefined;

          if (dialogPostHoldMs > 0 && !page.isClosed()) {
            const viewport = page.viewportSize();
            if (!viewport) {
              throw new Error("videoMode cannot capture a post-dialog frame without a viewport");
            }
            const path = join(testInfo.outputDir, VIDEO_MODE_DIALOG_POST_FRAME_FILE);
            await page.screenshot({ path, scale: "css" });
            dialogPostFrame = { path, viewport };
          }

          if (finalHold > 0 && !page.isClosed()) {
            const viewport = page.viewportSize();
            if (!viewport) {
              throw new Error("videoMode cannot capture a final frame without a viewport");
            }
            const path = join(testInfo.outputDir, VIDEO_MODE_FINAL_FRAME_FILE);
            await page.screenshot({ path, scale: "css" });
            finalFrame = { path, viewport };
          }

          let recordingEndedAt: number | undefined;
          if (!page.isClosed()) {
            const needsTimelineCalibration =
              addressBars.length > 0 ||
              captions.length > 0 ||
              highlights.length > 0 ||
              deadAirThreshold !== undefined ||
              finalHold > 0;
            if (needsTimelineCalibration) {
              await settleVideoRecorder(page);
              const closeStartedAt = performance.now();
              await page.close({ runBeforeUnload: false });
              const closeEndedAt = performance.now();
              if (state.startedAt !== undefined) {
                recordingEndedAt = Math.round(
                  (closeStartedAt + closeEndedAt) / 2 - state.startedAt,
                );
              }
            } else {
              await page.close({ runBeforeUnload: false });
            }
          }

          const recordedVideoPath = await video.path();
          await waitForNonEmptyFile(recordedVideoPath);
          await copyFile(recordedVideoPath, paths.raw);
          state.outputs.raw = VIDEO_MODE_RAW_FILE;
          await testInfo.attach("video-raw", {
            contentType: "video/webm",
            path: paths.raw,
          });

          const rawVideoInfo = await videoInfo(paths.raw);
          // Page pixels are not a clock marker: a final state can have appeared
          // earlier, and the final live paint might never reach the screencast.
          // settleVideoRecorder makes the recorder endpoint the reliable marker.
          const sourceOffset =
            recordingEndedAt === undefined ? 0 : rawVideoInfo.durationMs - recordingEndedAt;
          const timelineOffset =
            Math.floor(sourceOffset / rawVideoInfo.frameDurationMs) *
            rawVideoInfo.frameDurationMs;
          const renderTimeline = translateVideoTimeline({
            addressBars,
            captions,
            deadAir,
            highlights,
            offsetMs: timelineOffset,
          });
          // A selector-driven trim start resolves over the protocol and can
          // land a few milliseconds after a highlight recorded at effectively
          // the same moment. The race must not drop that highlight, so a start
          // within one source frame after a highlight start moves back to it.
          if (state.sourceRange.start !== undefined) {
            const rangeStart = state.sourceRange.start;
            const racedHighlightStarts = highlights
              .map((candidate) => candidate.start)
              .filter(
                (start) =>
                  start < rangeStart && rangeStart - start <= rawVideoInfo.frameDurationMs,
              );
            if (racedHighlightStarts.length > 0) {
              state.sourceRange.start = Math.min(...racedHighlightStarts);
            }
          }
          const annotationSourceRange = metadataFor(state).sourceRange;
          const sourceRange = translateSourceRange(annotationSourceRange, timelineOffset);

          // No explicit or selector-driven start: fall back to detecting where
          // the blank startup ends in the recorded pixels, and trim to there
          // when the lead-in is long enough to be worth removing. The second
          // `undefined` check guards the window across the ffmpeg await: if a
          // selector start landed meanwhile, it wins.
          //
          // A detected start is already in raw-video time. Explicit timestamps,
          // captions, dead air, and highlights are translated from videoMode's
          // clock using the settled recording endpoint above.
          if (trimStart.detectBlank && annotationSourceRange.start === undefined) {
            const detectedStart = await detectBlankLeadInEndMs(paths.raw);
            if (
              detectedStart !== undefined &&
              detectedStart >= TRIM_START_MIN_LEAD_IN_MS &&
              annotationSourceRange.start === undefined
            ) {
              state.sourceRange.start = detectedStart;
              sourceRange.start = detectedStart;
            }
          }

          if (sourceRange.start === undefined) {
            sourceRange.start = Math.max(0, timelineOffset);
          }

          if (sourceRange.end === undefined && recordingEndedAt !== undefined) {
            const minimumHighlightEnd = renderTimeline.highlights.reduce(
              (end, candidate) =>
                Math.max(end, candidate.start + 1, candidate.actionEnd || 0),
              0,
            );
            const minimumAddressBarEnd = renderTimeline.addressBars.reduce(
              (end, candidate) =>
                Math.max(end, candidate.start + rawVideoInfo.frameDurationMs),
              0,
            );
            sourceRange.end = Math.max(
              minimumAddressBarEnd,
              minimumHighlightEnd,
              Math.round(renderEndedAt + sourceOffset),
            );
          }

          if (
            addressBars.length > 0 ||
            captions.length > 0 ||
            highlights.length > 0 ||
            deadAirThreshold !== undefined ||
            finalHold > 0 ||
            sourceRangeIsSet(state.sourceRange)
          ) {
            const wroteRenderedVideo = await renderVideo({
              addressBars: renderTimeline.addressBars,
              captions: renderTimeline.captions,
              deadAir: renderTimeline.deadAir,
              dialogPostFrame,
              dialogPostHoldMs,
              finalFrame,
              finalHoldMs: finalHold,
              highlightMode: highlight.mode === "pointer" ? "pointer" : "outline",
              highlights: renderTimeline.highlights,
              inputPath: paths.raw,
              outputDir: testInfo.outputDir,
              outputPath: paths.rendered,
              sourceRange,
              thresholdMs: deadAirThreshold,
              timelineOffsetMs: timelineOffset,
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
          metadata.addressBars.length > 0 ||
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
        if (
          addressBarOriginalGoto &&
          addressBarPage &&
          addressBarGoto &&
          addressBarPage.goto === addressBarGoto
        ) {
          Object.assign(addressBarPage, { goto: addressBarOriginalGoto });
        }
        if (dialogPage && onDialog) {
          dialogPage.off("dialog", onDialog);
        }
      };
    },
  };
};
