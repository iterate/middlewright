import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts } from "../theme";

/**
 * One-line playwright.config.ts strip showing the actionTimeout, with an
 * optional animated old-value-struck-out → new-value replacement.
 */
export const ConfigChip: React.FC<{
  width: number;
  height: number;
  value: string;
  comment?: string;
  replace?: { to: string; at: number; toColor?: string };
}> = ({ width, height, value, comment, replace }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const replacing = replace !== undefined && frame >= replace.at;
  const entrance = replacing
    ? spring({ frame: frame - replace.at, fps, config: { damping: 14, stiffness: 200 }, durationInFrames: 20 })
    : 0;

  return (
    <div
      style={{
        width,
        height,
        background: colors.panel,
        border: `1.5px solid ${colors.border}`,
        borderRadius: 14,
        display: "flex",
        alignItems: "center",
        padding: "0 20px",
        gap: 18,
        boxSizing: "border-box",
        boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
        fontFamily: fonts.mono,
        fontSize: 18,
        whiteSpace: "pre",
        fontFeatureSettings: '"liga" 0, "calt" 0',
      }}
    >
      <span style={{ fontFamily: fonts.ui, fontSize: 15, color: colors.faint, fontWeight: 600 }}>
        playwright.config.ts
      </span>
      <span style={{ color: colors.synDefault }}>
        {"use: { actionTimeout: "}
        <span
          style={{
            color: replacing ? colors.faint : colors.synNumber,
            textDecoration: replacing ? "line-through" : "none",
          }}
        >
          {value}
        </span>
        {replacing && (
          <span
            style={{
              display: "inline-block",
              color: replace.toColor || colors.synNumber,
              fontWeight: 700,
              marginLeft: 12,
              opacity: entrance,
              transform: `scale(${interpolate(entrance, [0, 1], [1.6, 1])})`,
            }}
          >
            {replace.to}
          </span>
        )}
        {" }"}
      </span>
      {comment && <span style={{ color: colors.synComment, fontStyle: "italic" }}>{comment}</span>}
    </div>
  );
};
