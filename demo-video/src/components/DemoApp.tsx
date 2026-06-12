import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { fonts } from "../theme";

/** Coordinates within the browser content area (900x394), for aiming the cursor */
export const REPORT_BUTTON_CENTER = { x: 156, y: 192 };
export const READY_CENTER = { x: 190, y: 286 };
export const CURSOR_HOME = { x: 620, y: 330 };

export const DemoApp: React.FC<{
  /** local frame of the button click (visual press feedback) */
  pressedAt?: number;
  /** show the "Generating…" loading row between these local frames (the product has a spinner) */
  spinnerFrom?: number;
  spinnerTo?: number;
  /** local frame at which the finished report row appears */
  readyFrom?: number;
}> = ({ pressedAt, spinnerFrom, spinnerTo, readyFrom }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const pressed =
    pressedAt !== undefined
      ? interpolate(frame, [pressedAt - 2, pressedAt + 1, pressedAt + 7], [1, 0.96, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1;

  const spinnerVisible =
    spinnerFrom !== undefined && frame >= spinnerFrom && (spinnerTo === undefined || frame < spinnerTo);
  const readyVisible = readyFrom !== undefined && frame >= readyFrom;
  const readyEntrance = readyVisible
    ? spring({ frame: frame - (readyFrom as number), fps, config: { damping: 200 }, durationInFrames: 16 })
    : 0;

  return (
    <div style={{ position: "absolute", inset: 0, background: "#f6f7f9", fontFamily: fonts.ui }}>
      {/* app bar */}
      <div
        style={{
          height: 56,
          background: "#fff",
          borderBottom: "1px solid #e3e6eb",
          display: "flex",
          alignItems: "center",
          padding: "0 32px",
          gap: 12,
        }}
      >
        <div style={{ width: 24, height: 24, borderRadius: 7, background: "#4f46e5" }} />
        <span style={{ fontWeight: 700, fontSize: 18, color: "#1c2230" }}>Acme Console</span>
        <div style={{ flex: 1 }} />
        {["Dashboard", "Reports", "Settings"].map((item) => (
          <span
            key={item}
            style={{
              fontSize: 15,
              color: item === "Reports" ? "#4f46e5" : "#717a8c",
              fontWeight: item === "Reports" ? 600 : 400,
              marginLeft: 22,
            }}
          >
            {item}
          </span>
        ))}
      </div>

      {/* report card */}
      <div
        style={{
          position: "absolute",
          left: 32,
          top: 84,
          width: 836,
          height: 150,
          background: "#fff",
          borderRadius: 14,
          border: "1px solid #e3e6eb",
          boxShadow: "0 4px 16px rgba(28,34,48,0.06)",
          padding: 24,
          boxSizing: "border-box",
        }}
      >
        <div style={{ fontSize: 21, fontWeight: 600, color: "#1c2230" }}>Q2 Financial Report</div>
        <div style={{ fontSize: 15, color: "#717a8c", marginTop: 6 }}>
          Revenue, costs and forecasts for Q2 2026 — takes about 20 seconds to generate.
        </div>
        <div
          style={{
            position: "absolute",
            left: 24,
            bottom: 22,
            width: 200,
            height: 44,
            borderRadius: 10,
            background: "#4f46e5",
            color: "#fff",
            fontSize: 16,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transform: `scale(${pressed})`,
            boxShadow: "0 2px 8px rgba(79,70,229,0.35)",
          }}
        >
          Generate report
        </div>
      </div>

      {/* status area */}
      {spinnerVisible && (
        <div
          style={{
            position: "absolute",
            left: 32,
            top: 264,
            display: "flex",
            alignItems: "center",
            gap: 14,
            color: "#4f46e5",
            fontSize: 17,
            fontWeight: 500,
          }}
        >
          <Spinner frame={frame} />
          Generating…
        </div>
      )}

      {readyVisible && (
        <div
          style={{
            position: "absolute",
            left: 32,
            top: 258,
            width: 836,
            height: 56,
            borderRadius: 10,
            background: "#ecfdf3",
            border: "1.5px solid #6ee7a0",
            display: "flex",
            alignItems: "center",
            padding: "0 20px",
            gap: 10,
            boxSizing: "border-box",
            opacity: readyEntrance,
            transform: `translateY(${interpolate(readyEntrance, [0, 1], [10, 0])}px)`,
          }}
        >
          <span style={{ fontSize: 19 }}>✅</span>
          <span style={{ fontSize: 17, fontWeight: 600, color: "#067647", textDecoration: "underline" }}>
            Report ready
          </span>
          <span style={{ fontSize: 14, color: "#5a6170" }}>— q2-financial-report.pdf</span>
        </div>
      )}
    </div>
  );
};

const Spinner: React.FC<{ frame: number }> = ({ frame }) => (
  <div
    style={{
      width: 26,
      height: 26,
      borderRadius: 999,
      border: "4px solid #d9dcfb",
      borderTopColor: "#4f46e5",
      transform: `rotate(${(frame * 14) % 360}deg)`,
    }}
  />
);
