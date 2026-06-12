import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts } from "../theme";

const variants = {
  info: { color: colors.blue, emoji: "💡" },
  problem: { color: colors.red, emoji: "🚨" },
  warn: { color: colors.amber, emoji: "⚠️" },
  solution: { color: colors.green, emoji: "✅" },
};

/**
 * A popover callout that springs in at `at` (local frames), with a triangle
 * arrow on one edge pointing at whatever it annotates.
 */
export const Annotation: React.FC<{
  at: number;
  /** local frame at which the popover fades back out (default: stays for the scene) */
  until?: number;
  x: number;
  y: number;
  width?: number;
  variant: keyof typeof variants;
  /** which edge of the popover the arrow sits on (i.e. the direction it points) */
  arrow: "left" | "right" | "top" | "bottom";
  /** px offset of the arrow along its edge, from the start of that edge */
  arrowOffset?: number;
  children: React.ReactNode;
}> = ({ at, until, x, y, width = 400, variant, arrow, arrowOffset = 40, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < at) return null;
  if (until !== undefined && frame > until + 10) return null;

  const { color, emoji } = variants[variant];
  const enter = spring({ frame: frame - at, fps, config: { damping: 14, stiffness: 180 }, durationInFrames: 25 });
  const exit =
    until === undefined
      ? 0
      : interpolate(frame, [until, until + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const entrance = enter * (1 - exit);
  const drift = { left: [-14, 0], right: [14, 0], top: [0, -14], bottom: [0, 14] }[arrow];

  const arrowSize = 14;
  const arrowStyle: React.CSSProperties = {
    position: "absolute",
    width: 0,
    height: 0,
    ...(arrow === "left" && {
      left: -arrowSize,
      top: arrowOffset,
      borderTop: `${arrowSize}px solid transparent`,
      borderBottom: `${arrowSize}px solid transparent`,
      borderRight: `${arrowSize}px solid ${color}`,
    }),
    ...(arrow === "right" && {
      right: -arrowSize,
      top: arrowOffset,
      borderTop: `${arrowSize}px solid transparent`,
      borderBottom: `${arrowSize}px solid transparent`,
      borderLeft: `${arrowSize}px solid ${color}`,
    }),
    ...(arrow === "top" && {
      top: -arrowSize,
      left: arrowOffset,
      borderLeft: `${arrowSize}px solid transparent`,
      borderRight: `${arrowSize}px solid transparent`,
      borderBottom: `${arrowSize}px solid ${color}`,
    }),
    ...(arrow === "bottom" && {
      bottom: -arrowSize,
      left: arrowOffset,
      borderLeft: `${arrowSize}px solid transparent`,
      borderRight: `${arrowSize}px solid transparent`,
      borderTop: `${arrowSize}px solid ${color}`,
    }),
  };

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        zIndex: 100,
        opacity: Math.min(1, entrance * 1.4),
        transform: `scale(${interpolate(entrance, [0, 1], [0.82, 1])}) translate(${
          interpolate(entrance, [0, 1], [drift[0], 0])
        }px, ${interpolate(entrance, [0, 1], [drift[1], 0])}px)`,
        transformOrigin: { left: "left center", right: "right center", top: "center top", bottom: "center bottom" }[arrow],
      }}
    >
      <div
        style={{
          position: "relative",
          background: "rgba(13, 17, 27, 0.96)",
          border: `2px solid ${color}`,
          borderRadius: 14,
          padding: "16px 20px",
          fontFamily: fonts.ui,
          fontSize: 22,
          lineHeight: 1.45,
          color: colors.text,
          boxShadow: `0 12px 40px rgba(0,0,0,0.55), 0 0 24px ${color}33`,
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
        }}
      >
        <div style={arrowStyle} />
        <span style={{ fontSize: 24, lineHeight: 1.3 }}>{emoji}</span>
        <span>{children}</span>
      </div>
    </div>
  );
};
