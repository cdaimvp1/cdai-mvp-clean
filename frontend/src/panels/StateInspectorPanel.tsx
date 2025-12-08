import React from "react";
import { useGovernanceStore } from "../state/governanceStore";

const summaryBoxStyle: React.CSSProperties = {
  padding: 12,
  borderRadius: 8,
  border: "1px solid rgba(148,163,184,0.3)",
  background: "rgba(15,23,42,0.55)",
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

export default function StateInspectorPanel() {
  const summary = useGovernanceStore((state) => ({
    activeSessionId: state.activeSessionId,
    cycleStatus: state.cycleStatus,
    dataScopeMode: state.dataScopeMode,
    strictnessLevel: state.strictnessLevel,
    currentCycle: state.currentCycle,
    cyclePlan: state.cyclePlan,
    gilState: state.gilState,
    pendingClarification: state.pendingClarification,
  }));
  const canonicalTrace = useGovernanceStore((state) => state.canonicalTrace);

  return (
    <div
      className="panel-surface"
      style={{
        padding: 16,
        fontFamily: "Arimo, sans-serif",
        color: "#f8fafc",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <h2 style={{ fontSize: 18, fontWeight: 600 }}>State Inspector</h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        <div style={summaryBoxStyle}>
          <span style={{ fontSize: 12, textTransform: "uppercase", color: "#94a3b8" }}>Cycle Status</span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{summary.cycleStatus}</span>
        </div>
        <div style={summaryBoxStyle}>
          <span style={{ fontSize: 12, textTransform: "uppercase", color: "#94a3b8" }}>Strictness</span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{summary.strictnessLevel ?? "n/a"}</span>
        </div>
        <div style={summaryBoxStyle}>
          <span style={{ fontSize: 12, textTransform: "uppercase", color: "#94a3b8" }}>Data Scope Mode</span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{summary.dataScopeMode}</span>
        </div>
        <div style={summaryBoxStyle}>
          <span style={{ fontSize: 12, textTransform: "uppercase", color: "#94a3b8" }}>Current Cycle</span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>
            {summary.currentCycle != null ? `#${summary.currentCycle}` : "n/a"}
          </span>
        </div>
        <div style={summaryBoxStyle}>
          <span style={{ fontSize: 12, textTransform: "uppercase", color: "#94a3b8" }}>Cycle Plan</span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{summary.cyclePlan ?? "n/a"}</span>
        </div>
        <div style={summaryBoxStyle}>
          <span style={{ fontSize: 12, textTransform: "uppercase", color: "#94a3b8" }}>GIL State</span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{summary.gilState}</span>
        </div>
      </div>

      <div style={summaryBoxStyle}>
        <span style={{ fontSize: 12, textTransform: "uppercase", color: "#94a3b8" }}>Active Session</span>
        <span style={{ fontSize: 16, fontWeight: 600 }}>{summary.activeSessionId || "No active session"}</span>
      </div>

      <div style={summaryBoxStyle}>
        <span style={{ fontSize: 12, textTransform: "uppercase", color: "#94a3b8" }}>
          Pending Clarification
        </span>
        <span style={{ fontSize: 14 }}>
          {summary.pendingClarification?.question
            ? summary.pendingClarification.question
            : "No clarification requested."}
        </span>
      </div>

      <div style={summaryBoxStyle}>
        <span style={{ fontSize: 12, textTransform: "uppercase", color: "#94a3b8" }}>Canonical Trace Snapshot</span>
        <pre
          style={{
            margin: 0,
            fontSize: 12,
            whiteSpace: "pre-wrap",
            color: "#cbd5f5",
            maxHeight: 220,
            overflow: "auto",
          }}
        >
          {JSON.stringify(canonicalTrace || {}, null, 2)}
        </pre>
      </div>
    </div>
  );
}
