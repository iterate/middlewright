import React from "react";
import { colors, fonts } from "../theme";

export const BROWSER_CHROME_H = 76;

export const BrowserWindow: React.FC<{
  width: number;
  height: number;
  url?: string;
  children: React.ReactNode;
}> = ({ width, height, url = "localhost:3000/reports", children }) => {
  return (
    <div
      style={{
        width,
        height,
        background: "#f6f7f9",
        borderRadius: 16,
        overflow: "hidden",
        border: `1.5px solid ${colors.border}`,
        boxShadow: "0 24px 70px rgba(0,0,0,0.55)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          height: BROWSER_CHROME_H,
          flexShrink: 0,
          background: "#e6e8ec",
          borderBottom: "1px solid #d4d7dd",
          display: "flex",
          alignItems: "center",
          padding: "0 20px",
          gap: 10,
        }}
      >
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
          <div key={c} style={{ width: 14, height: 14, borderRadius: 999, background: c }} />
        ))}
        <div
          style={{
            flex: 1,
            marginLeft: 16,
            height: 40,
            background: "#fff",
            borderRadius: 10,
            border: "1px solid #d4d7dd",
            display: "flex",
            alignItems: "center",
            padding: "0 16px",
            fontFamily: fonts.ui,
            fontSize: 17,
            color: "#5a6170",
            gap: 8,
          }}
        >
          <LockIcon />
          {url}
        </div>
      </div>
      {/* content area: position: relative so cursor overlays share its coordinate space */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>{children}</div>
    </div>
  );
};

const LockIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5a6170" strokeWidth="2.5">
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);
