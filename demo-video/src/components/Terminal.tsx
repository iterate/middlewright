import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { colors, fonts } from "../theme";

export type TerminalLine = {
  /** local frame at which the line appears */
  at: number;
  text: string;
  color?: string;
  bold?: boolean;
  /** 'cmd' lines get a ❯ prompt and a typewriter effect */
  type?: "cmd" | "out";
};

const TYPE_DURATION = 22; // frames to type a command

export const Terminal: React.FC<{
  lines: TerminalLine[];
  width: number;
  height: number;
  /** simulated elapsed test time shown in the header, null hides it */
  stopwatchMs?: number | null;
  stopwatchSpedUp?: boolean;
  fontSize?: number;
}> = ({ lines, width, height, stopwatchMs = null, stopwatchSpedUp = false, fontSize = 17 }) => {
  const frame = useCurrentFrame();
  const visible = lines.filter((line) => frame >= line.at);
  const lastCmd = [...visible].reverse().find((line) => line.type === "cmd");
  const typingDone = !lastCmd || frame >= lastCmd.at + TYPE_DURATION;
  const caretOn = Math.floor(frame / 16) % 2 === 0;

  return (
    <div
      style={{
        width,
        height,
        background: "#0a0c12",
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
          height: 44,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          gap: 8,
          background: colors.panelLight,
          borderBottom: `1.5px solid ${colors.border}`,
          fontFamily: fonts.ui,
        }}
      >
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
          <div key={c} style={{ width: 13, height: 13, borderRadius: 999, background: c }} />
        ))}
        <span style={{ color: colors.dim, fontSize: 16, fontWeight: 500, marginLeft: 8 }}>terminal</span>
        <div style={{ flex: 1 }} />
        {stopwatchMs !== null && (
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              fontFamily: fonts.mono,
              fontSize: 18,
              color: stopwatchMs >= 15000 ? colors.amber : colors.text,
              fontWeight: 700,
            }}
          >
            <span>⏱ {(stopwatchMs / 1000).toFixed(1)}s</span>
            {stopwatchSpedUp && (
              <span style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint, fontWeight: 500 }}>
                (sped up)
              </span>
            )}
          </div>
        )}
      </div>
      <div
        style={{
          padding: "14px 20px",
          fontFamily: fonts.mono,
          fontSize,
          lineHeight: 1.6,
          overflow: "hidden",
          whiteSpace: "pre-wrap",
          fontFeatureSettings: '"liga" 0, "calt" 0',
        }}
      >
        {visible.map((line, i) => {
          const isTypingLine = line === lastCmd && !typingDone;
          const isIdleCmd = line === lastCmd && typingDone && i === visible.length - 1;
          const shownChars = isTypingLine
            ? Math.round(
                interpolate(frame, [line.at, line.at + TYPE_DURATION], [0, line.text.length], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }),
              )
            : line.text.length;
          return (
            <div key={i} style={{ color: line.color || colors.text, fontWeight: line.bold ? 700 : 400 }}>
              {line.type === "cmd" && <span style={{ color: colors.green }}>❯ </span>}
              {line.text.slice(0, shownChars)}
              {(isTypingLine || isIdleCmd) && caretOn && <span style={{ color: colors.text }}>▋</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
};
