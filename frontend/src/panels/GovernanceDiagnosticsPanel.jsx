import React from "react";

const placeholderSections = [
  {
    key: "matrix",
    title: "Matrix Evaluations",
    description: "Full scoring context for each governance matrix execution will appear here.",
  },
  {
    key: "canonicalTrace",
    title: "Canonical Trace",
    description: "Displays the canonical trace transcript with scoped deltas between cycles.",
  },
  {
    key: "mcpTimeline",
    title: "MCP Timeline",
    description: "Live feed of MCP entry modes, step logs, and transition breadcrumbs.",
  },
  {
    key: "deepLogs",
    title: "Deep Governance Logs",
    description: "Consolidated logbook for moderator escalations and policy escalations.",
  },
  {
    key: "hemisphereLogs",
    title: "Hemisphere Logs",
    description: "Raw hemisphere logging output for analytical and creative passes.",
  },
  {
    key: "ruleEvaluations",
    title: "Rule Evaluations",
    description: "Raw rule-by-rule evaluation snapshots, including overrides and skips.",
  },
  {
    key: "narrativeDrift",
    title: "Narrative Drift",
    description: "Diff view that surfaces narrative drift or grounding issues cycle-to-cycle.",
  },
  {
    key: "ruleTree",
    title: "Rule-tree Evaluations",
    description: "Interactive rule tree diagnostics with pass/fail markers.",
  },
  {
    key: "hitMiss",
    title: "Hit/Miss Diagnostics",
    description: "Summary of delivery hits, misses, retries, and socket-level verdicts.",
  },
];

const panelStyle = {
  height: "100%",
  display: "flex",
  flexDirection: "column",
  padding: 20,
  background: "rgba(5,5,5,0.96)",
  borderRadius: 12,
  border: "1px solid rgba(148,163,184,0.2)",
  color: "#e2e8f0",
  fontFamily: "Arimo, sans-serif",
  gap: 20,
};

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 14,
  overflow: "auto",
  paddingBottom: 8,
};

const cardStyle = {
  borderRadius: 10,
  border: "1px dashed rgba(148,163,184,0.35)",
  background: "rgba(10,10,10,0.92)",
  padding: 14,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  minHeight: 140,
};

export default function GovernanceDiagnosticsPanel() {
  return (
    <div style={panelStyle}>
      <div>
        <h2 style={{ fontSize: 18, margin: 0 }}>Governance Diagnostics</h2>
        <p style={{ fontSize: 13, marginTop: 6, color: "#cbd5f5", maxWidth: 640 }}>
          Detailed diagnostics for matrix evaluations, canonical traces, and telemetry feeds will return here. Use this
          panel to preview where each diagnostic stream will live once extraction work is complete.
        </p>
      </div>
      <div style={gridStyle}>
        {placeholderSections.map((section) => (
          <div key={section.key} style={cardStyle}>
            <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0.6, textTransform: "uppercase" }}>
              {section.title}
            </span>
            <p style={{ fontSize: 12, margin: 0, color: "#94a3b8" }}>{section.description}</p>
            <div
              style={{
                marginTop: "auto",
                fontSize: 11,
                color: "#64748b",
              }}
            >
              Placeholder content
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
