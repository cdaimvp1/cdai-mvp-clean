import React from "react";
import { GilState } from "../../state/governanceStore";

export default function GILIndicator({ state }: { state: GilState }) {
  const color =
    state === "green"
      ? "#22c55e"
      : state === "red"
      ? "#ef4444"
      : state === "amber"
      ? "#f59e0b"
      : "#737373";
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 8, border: "1px solid #1f1f1f", background: "#1a1a1a" }}>
      <span style={{ fontFamily: "Arimo, sans-serif", fontSize: 11, color: "#e5e5e5", letterSpacing: "0.08em" }}>GIL</span>
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: "999px",
          border: "1px solid #2a2a2a",
          backgroundColor: color,
          boxShadow: state === "idle" ? "none" : `0 0 8px ${color}80`,
        }}
        aria-label="GIL indicator"
      />
    </div>
  );
}
