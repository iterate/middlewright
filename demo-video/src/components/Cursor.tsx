import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";

type Waypoint = { x: number; y: number; at: number };

/**
 * An animated mouse pointer, positioned within its nearest relative parent
 * (the BrowserWindow content area). Moves between waypoints, pulses on click.
 */
export const Cursor: React.FC<{
  moves: Waypoint[];
  clicksAt?: number[];
  visibleFrom?: number;
  visibleTo?: number;
}> = ({ moves, clicksAt = [], visibleFrom = 0, visibleTo }) => {
  const frame = useCurrentFrame();
  if (frame < visibleFrom || (visibleTo !== undefined && frame > visibleTo)) return null;

  const times = moves.map((m) => m.at);
  const opts = {
    easing: Easing.inOut(Easing.quad),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  } as const;
  const x = moves.length > 1 ? interpolate(frame, times, moves.map((m) => m.x), opts) : moves[0].x;
  const y = moves.length > 1 ? interpolate(frame, times, moves.map((m) => m.y), opts) : moves[0].y;

  const fadeIn = interpolate(frame, [visibleFrom, visibleFrom + 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  let scale = 1;
  for (const clickAt of clicksAt) {
    scale *= interpolate(frame, [clickAt - 3, clickAt, clickAt + 6], [1, 0.8, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  }

  return (
    <div style={{ position: "absolute", left: x, top: y, zIndex: 50, opacity: fadeIn }}>
      {clicksAt.map((clickAt) => {
        if (frame < clickAt || frame > clickAt + 16) return null;
        const size = interpolate(frame, [clickAt, clickAt + 16], [12, 64]);
        const opacity = interpolate(frame, [clickAt, clickAt + 16], [0.7, 0]);
        return (
          <div
            key={clickAt}
            style={{
              position: "absolute",
              left: -size / 2,
              top: -size / 2,
              width: size,
              height: size,
              borderRadius: 999,
              border: "3px solid #4f46e5",
              opacity,
            }}
          />
        );
      })}
      {/* offset so the arrow TIP (at ~7,4 within the svg) sits exactly on the target point */}
      <svg
        width="30"
        height="30"
        viewBox="0 0 24 24"
        style={{
          transform: `translate(-7px, -4px) scale(${scale})`,
          transformOrigin: "7px 4px",
          filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.4))",
        }}
      >
        <path
          d="M5.5 3.2 L5.5 17.5 L9 14.4 L11.3 19.8 L13.8 18.7 L11.5 13.4 L16.2 13.2 Z"
          fill="#fff"
          stroke="#1c2230"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};
