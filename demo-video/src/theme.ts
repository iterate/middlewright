import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

const inter = loadInter("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin"] });
const mono = loadMono("normal", { weights: ["400", "700"], subsets: ["latin"] });

export const fonts = {
  ui: inter.fontFamily,
  mono: mono.fontFamily,
};

export const colors = {
  bg: "#0b0e14",
  bgGlow: "#141a28",
  panel: "#11151f",
  panelLight: "#171c29",
  border: "#252c3b",
  text: "#e6e8ee",
  dim: "#8b93a7",
  faint: "#5b6375",

  green: "#4ade80",
  red: "#f87171",
  amber: "#fbbf24",
  blue: "#60a5fa",
  cyan: "#67e8f9",
  purple: "#c084fc",

  // one-dark-ish syntax palette
  synKeyword: "#c678dd",
  synString: "#98c379",
  synNumber: "#d19a66",
  synComment: "#7d8590",
  synDefault: "#abb2bf",
  synFn: "#61afef",
};

// Workbench layout constants (1920x1080 canvas)
// Left half: spec on top, optional config chip + ancillary code below.
// Right half: compact browser on top, terminal below.
export const layout = {
  pad: 48,
  labelY: 40,
  top: 116,
  spec: { x: 48, y: 116, w: 900, h: 440 },
  chip: { x: 48, y: 572, w: 900, h: 64 },
  ancillary: { x: 48, y: 652, w: 900, h: 348 },
  browser: { x: 972, y: 116, w: 900, h: 470 },
  terminal: { x: 972, y: 602, w: 900, h: 390 },
};
