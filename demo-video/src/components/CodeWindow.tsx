import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts } from "../theme";
import { HighlightedLine } from "./highlight";

export type CodeLine = {
  text: string;
  /** 'add' = green diff line, 'del' = red strikethrough diff line, 'focus' = gold highlight */
  kind?: "normal" | "add" | "del" | "focus";
  /** local frame at which this line appears (default: 0, i.e. always visible) */
  appearAt?: number;
  /** local frame at which a 'focus' highlight kicks in (defaults to appearAt) */
  focusAt?: number;
  /** local frame at which this line flips from normal to 'del' (renders normal before) */
  delAt?: number;
};

export const CodeWindow: React.FC<{
  title: string;
  lines: CodeLine[];
  width: number;
  height: number;
  fontSize?: number;
}> = ({ title, lines, width, height, fontSize = 19 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <div
      style={{
        width,
        height,
        background: colors.panel,
        border: `1.5px solid ${colors.border}`,
        borderRadius: 14,
        overflow: "hidden",
        boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          height: 46,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 18px",
          background: colors.panelLight,
          borderBottom: `1.5px solid ${colors.border}`,
          fontFamily: fonts.ui,
        }}
      >
        <FileIcon />
        <span style={{ color: colors.dim, fontSize: 17, fontWeight: 500 }}>{title}</span>
      </div>
      <div
        style={{
          padding: "16px 0",
          fontFamily: fonts.mono,
          fontSize,
          lineHeight: 1.55,
          overflow: "hidden",
          fontFeatureSettings: '"liga" 0, "calt" 0',
        }}
      >
        {lines.map((line, i) => {
          const appearAt = line.appearAt || 0;
          const entrance =
            appearAt === 0
              ? 1
              : spring({ frame: frame - appearAt, fps, config: { damping: 200 }, durationInFrames: 14 });
          if (frame < appearAt) return <div key={i} style={{ height: fontSize * 1.55 }} />;

          const kind = line.delAt !== undefined ? (frame >= line.delAt ? "del" : "normal") : line.kind || "normal";
          const focusAt = line.focusAt === undefined ? appearAt : line.focusAt;
          const focusProgress =
            kind === "focus"
              ? spring({ frame: frame - focusAt, fps, config: { damping: 200 }, durationInFrames: 20 })
              : 0;
          const background =
            kind === "add"
              ? "rgba(74, 222, 128, 0.12)"
              : kind === "del"
                ? "rgba(248, 113, 113, 0.10)"
                : kind === "focus"
                  ? `rgba(251, 191, 36, ${0.14 * focusProgress})`
                  : "transparent";
          const gutter = kind === "add" ? "+" : kind === "del" ? "-" : " ";
          const gutterColor = kind === "add" ? colors.green : kind === "del" ? colors.red : colors.faint;

          return (
            <div
              key={i}
              style={{
                display: "flex",
                background,
                opacity: entrance,
                transform: `translateX(${interpolate(entrance, [0, 1], [18, 0])}px)`,
                borderLeft:
                  kind === "focus"
                    ? `3px solid rgba(251, 191, 36, ${focusProgress})`
                    : "3px solid transparent",
              }}
            >
              <span
                style={{
                  width: 54,
                  flexShrink: 0,
                  textAlign: "center",
                  color: gutterColor,
                  fontWeight: kind === "normal" ? 400 : 700,
                  userSelect: "none",
                }}
              >
                {gutter === " " ? String(i + 1) : gutter}
              </span>
              <span
                style={{
                  whiteSpace: "pre",
                  textDecoration: kind === "del" ? "line-through" : "none",
                  opacity: kind === "del" ? 0.65 : 1,
                }}
              >
                <HighlightedLine text={line.text} />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const FileIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={colors.faint} strokeWidth="2">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);
