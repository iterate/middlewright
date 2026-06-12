import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts } from "../theme";

export const TitleScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const pop = (delay: number) =>
    spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: 20 });
  const line = (delay: number): React.CSSProperties => ({
    opacity: pop(delay),
    transform: `translateY(${interpolate(pop(delay), [0, 1], [14, 0])}px)`,
  });
  const caretOn = Math.floor(frame / 16) % 2 === 0;

  return (
    <AbsoluteFill
      style={{ background: colors.bg, justifyContent: "center", fontFamily: fonts.mono, paddingLeft: 420 }}
    >
      <div style={{ fontSize: 96, fontWeight: 700, ...line(4) }}>
        <span style={{ color: colors.faint }}>❯ </span>
        <span style={{ color: colors.amber }}>middle</span>
        <span style={{ color: colors.text }}>wright</span>
        {caretOn && <span style={{ color: colors.faint, fontWeight: 400 }}>▋</span>}
      </div>
      <div style={{ fontSize: 30, color: colors.dim, marginTop: 40, ...line(28) }}>
        <span style={{ color: colors.faint }}># </span>middleware for Playwright locator actions
      </div>
      <div style={{ fontSize: 25, color: colors.faint, marginTop: 18, ...line(50) }}>
        <span># </span>fast tests vs. a slow feature — and how both can win
      </div>
    </AbsoluteFill>
  );
};
