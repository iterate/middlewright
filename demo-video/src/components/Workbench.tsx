import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts, layout } from "../theme";
import { BrowserWindow } from "./BrowserWindow";

/**
 * The shared layout: report.spec.ts top-left (always), optional config chip
 * and ancillary code (test-helpers / product code) below it, compact browser
 * app top-right, terminal bottom-right. Annotations float on top.
 */
export const Workbench: React.FC<{
  label: string;
  labelColor?: string;
  spec: React.ReactNode;
  chip?: React.ReactNode;
  chipAt?: number;
  ancillary?: React.ReactNode;
  ancillaryAt?: number;
  app: React.ReactNode;
  terminal: React.ReactNode;
  animateIn?: boolean;
  children?: React.ReactNode; // annotations & other overlays
}> = ({ label, labelColor = colors.blue, spec, chip, chipAt = 0, ancillary, ancillaryAt = 0, app, terminal, animateIn = false, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const slide = (delay: number) =>
    animateIn ? spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: 22 }) : 1;
  const rise = (at: number) =>
    spring({ frame: frame - at, fps, config: { damping: 200 }, durationInFrames: 18 });

  const panel = (
    node: React.ReactNode,
    pos: { x: number; y: number },
    entrance: number,
  ): React.ReactNode => (
    <div
      style={{
        position: "absolute",
        left: pos.x,
        top: pos.y,
        opacity: entrance,
        transform: `translateY(${interpolate(entrance, [0, 1], [28, 0])}px)`,
      }}
    >
      {node}
    </div>
  );

  return (
    <AbsoluteFill style={{ background: colors.bg }}>
      {/* scene label */}
      <div
        style={{
          position: "absolute",
          left: layout.pad,
          top: layout.labelY,
          display: "flex",
          alignItems: "center",
          gap: 14,
          fontFamily: fonts.ui,
          opacity: slide(4),
        }}
      >
        <div style={{ width: 12, height: 12, borderRadius: 999, background: labelColor, boxShadow: `0 0 14px ${labelColor}` }} />
        <span style={{ fontSize: 27, fontWeight: 600, color: colors.text }}>{label}</span>
      </div>

      {panel(spec, layout.spec, slide(0))}
      {chip && panel(chip, layout.chip, Math.min(slide(6), rise(chipAt)))}
      {ancillary && panel(ancillary, layout.ancillary, Math.min(slide(8), rise(ancillaryAt)))}
      {panel(
        <BrowserWindow width={layout.browser.w} height={layout.browser.h}>
          {app}
        </BrowserWindow>,
        layout.browser,
        slide(8),
      )}
      {panel(terminal, layout.terminal, slide(12))}

      {children}
    </AbsoluteFill>
  );
};
