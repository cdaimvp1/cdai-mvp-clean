import React from "react";
import { useGovernanceStore } from "../state/governanceStore";

export default function ConstraintInspectorPanel() {
  const rules = useGovernanceStore((s) => s.normalizedRules);

  return (
    <div
      className="panel-surface"
      style={{
        padding: 16,
        fontFamily: "Arimo, sans-serif",
        color: "#f8fafc",
      }}
    >
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Constraint Inspector</h2>
      {Array.isArray(rules) && rules.length > 0 ? (
        <ol
          style={{
            listStyle: "decimal",
            marginLeft: 16,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {rules.map((rule, idx) => (
            <li
              key={rule.id || idx}
              style={{
                padding: 12,
                borderRadius: 8,
                background: "rgba(15,23,42,0.6)",
                border: "1px solid rgba(148,163,184,0.2)",
              }}
            >
              <div style={{ fontWeight: 600 }}>{rule.description || rule.text || "Unnamed rule"}</div>
              {rule.condition && (
                <div style={{ fontSize: 12, color: "#cbd5f5", marginTop: 4 }}>Condition: {rule.condition}</div>
              )}
              {rule.severity != null && (
                <div style={{ fontSize: 12, color: "#facc15", marginTop: 4 }}>Severity: {rule.severity}</div>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <div style={{ color: "#94a3b8" }}>No constraints have been normalized for this session.</div>
      )}
    </div>
  );
}
