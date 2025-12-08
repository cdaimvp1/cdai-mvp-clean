import React, { useState } from "react";
import { useGovernanceStore } from "../state/governanceStore";
import socket from "../socket";

const bodyStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "12px",
  background: "#121212",
  border: "1px solid #1f1f1f",
  borderRadius: 8,
  boxShadow: "0 6px 16px rgba(0,0,0,0.35)",
};

const ruleText = (rule: any, index: number) => {
  if (typeof rule === "string") return rule;
  if (rule && typeof rule === "object") {
    const parts = [];
    if (rule.text) parts.push(rule.text);
    if (rule.status) parts.push(`[${rule.status}]`);
    if (rule.origin) parts.push(`(${rule.origin})`);
    return parts.join(" ").trim() || `Rule ${index + 1}`;
  }
  return `Rule ${index + 1}`;
};

export default function ParsedRulesPanel() {
  const rules = useGovernanceStore((s) => s.normalizedRules);
  const setRules = useGovernanceStore((s) => s.setRules);
  const [clearing, setClearing] = useState(false);

  const handleClear = async () => {
    try {
      setClearing(true);
      await fetch("/api/clear-rules", { method: "POST", credentials: "include" });
      socket.emit("clear-rules");
      setRules([]);
    } catch (err) {
      console.error("Failed to clear rules", err);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={handleClear}
          disabled={clearing}
          style={{
            fontFamily: "Arimo, sans-serif",
            fontSize: 11,
            padding: "6px 10px",
            borderRadius: 8,
            border: "1px solid #1f1f1f",
            background: "#1a1a1a",
            color: "#e5e5e5",
            cursor: "pointer",
            opacity: clearing ? 0.6 : 1,
          }}
        >
          {clearing ? "Clearing..." : "Clear Rules"}
        </button>
      </div>
      <div style={bodyStyle}>
        {rules.length === 0 ? (
          <p style={{ fontFamily: "Arimo, sans-serif", fontSize: 11.5, color: "#9ca3af", margin: 0 }}>
            No governance rules received.
          </p>
        ) : (
          rules.map((rule, idx) => (
            <div
              key={idx}
              style={{
                display: "flex",
                gap: 10,
                borderLeft: "3px solid #4e7bff",
                paddingLeft: 10,
                marginBottom: 12,
              }}
            >
              <div style={{ fontFamily: "Arimo, sans-serif", fontSize: 11.25, color: "#e5e5e5", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 4 }}>{`Rule ${idx + 1}`}</div>
                {ruleText(rule, idx)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
