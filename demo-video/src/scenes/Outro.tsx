import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts } from "../theme";

const recap = [
  { icon: "✗", color: colors.red, text: "no spinner   → fail in 1 second, with a hint for the real fix" },
  { icon: "✓", color: colors.green, text: "spinner up   → wait patiently, up to 30 seconds" },
  { icon: "↻", color: colors.amber, text: "failing tests now push the product UX to improve" },
];

export const OutroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = (delay: number) =>
    spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: 20 });
  const line = (delay: number): React.CSSProperties => ({
    opacity: pop(delay),
    transform: `translateX(${interpolate(pop(delay), [0, 1], [18, 0])}px)`,
  });
  const caretOn = Math.floor(frame / 16) % 2 === 0;

  return (
    <AbsoluteFill
      style={{ background: colors.bg, justifyContent: "center", fontFamily: fonts.mono, paddingLeft: 380 }}
    >
      <div style={{ fontSize: 64, fontWeight: 700, ...line(4) }}>
        <span style={{ color: colors.faint }}>❯ </span>
        <span style={{ color: colors.amber }}>plug</span>
        <span style={{ color: colors.text }}>wright</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 22, marginTop: 56, fontSize: 27 }}>
        {recap.map((row, i) => (
          <div key={row.icon} style={{ whiteSpace: "pre", color: colors.text, ...line(30 + i * 20) }}>
            <span style={{ color: row.color, fontWeight: 700 }}>{row.icon} </span>
            {row.text}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 70, fontSize: 30, color: colors.text, ...line(100) }}>
        <span style={{ color: colors.green }}>❯ </span>pnpm add -D plugwright
        {caretOn && <span style={{ color: colors.faint }}>▋</span>}
      </div>
      <div style={{ marginTop: 22, fontSize: 22, color: colors.faint, ...line(120) }}>
        # github.com/iterate/plugwright
      </div>
    </AbsoluteFill>
  );
};
