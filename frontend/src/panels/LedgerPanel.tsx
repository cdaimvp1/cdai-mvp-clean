import React from "react";
import { useGovernanceStore, LedgerEntry } from "../state/governanceStore";

export default function LedgerPanel() {
  const entries = useGovernanceStore((s) => s.ledgerEvents);

  const colorForStage = (stage: string | undefined) => {
    const lower = (stage || "").toLowerCase();
    if (lower.includes("analytical")) return "#4e7bff";
    if (lower.includes("moderator")) return "#d1a100";
    if (lower.includes("creative")) return "#6b46ff";
    return "#4e7bff";
  };

  const formatCycleText = (cycle?: number, stage?: string, text?: string) => {
    const label = cycle != null ? `Cycle ${cycle}` : (text || "").replace(/cycle\s+/gi, "Cycle ");
    return stage ? `(${stage} ${label})` : label;
  };

  const badgesForEntry = (entry: LedgerEntry) => {
    const badges: string[] = [];
    const text = entry?.text || "";
    if (!text) return badges;
    if (/\[warning/i.test(text)) badges.push("Warning");
    if (/\[external data: used/i.test(text)) badges.push("External");
    if (/\[provenance: missing/i.test(text)) badges.push("Provenance Missing");
    if (/\[citation required: missing/i.test(text)) badges.push("Citation Missing");
    if (entry?.simulationMode) badges.push("Simulation");
    return badges;
  };

  const metadataForEntry = (text?: string) => {
    if (!text) return { provenance: null, citation: null, urls: [] as string[] };
    const provenanceMatch = text.match(/\[provenance:\s*([^\]]+)\]/i);
    const citationMatch = text.match(/\[citation:\s*([^\]]+)\]/i);
    const urls = Array.from(text.matchAll(/https?:\/\/\S+/gi)).map((m) => m[0]);
    return {
      provenance: provenanceMatch ? provenanceMatch[1] : null,
      citation: citationMatch ? citationMatch[1] : null,
      urls,
    };
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px",
          background: "#121212",
          border: "1px solid #1f1f1f",
          borderRadius: 8,
          boxShadow: "0 6px 16px rgba(0,0,0,0.35)",
        }}
      >
        {entries.length === 0 ? (
          <p style={{ fontFamily: "Arimo, sans-serif", fontSize: 11.5, color: "#9ca3af", margin: 0 }}>
            No ledger entries yet.
          </p>
        ) : (
          entries.map((entry) => {
            const badges = badgesForEntry(entry);
            const metadata = metadataForEntry(entry.text);
            const decision = (entry.decision || "").toString().toUpperCase();
            const decisionColor =
              decision === "PASS" ? "#22c55e" : decision === "FAIL" ? "#ef4444" : "#9ca3af";
            const detailSegments = [
              decision && `Decision: ${decision}`,
              entry.hemisphere && `Hemisphere: ${entry.hemisphere}`,
              (entry.strictness || entry.strictness === 0) && `Strictness: ${entry.strictness}`,
            ].filter(Boolean);
            const ruleIds = Array.isArray(entry.ruleIds) ? entry.ruleIds : [];
            const rationaleText =
              entry.rationale && entry.rationale !== entry.text ? entry.rationale : null;
            return (
              <div
                key={entry.id}
                style={{
                  display: "flex",
                  gap: 10,
                  borderLeft: `3px solid ${colorForStage(entry.stage || entry.text)}`,
                  paddingLeft: 10,
                  marginBottom: 12,
                }}
              >
                <div>
                  <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 6, fontFamily: "Arimo, sans-serif" }}>
                    {`${entry.timestamp || ""} ${formatCycleText(entry.cycle, entry.stage, entry.text)}`.trim()}
                  </div>
                  <div
                    style={{
                      fontFamily: "Arimo, sans-serif",
                      fontSize: 12,
                      color: "#f8fafc",
                      marginBottom: 4,
                      fontWeight: 600,
                    }}
                  >
                    {entry.stage || "Ledger Entry"}
                    {detailSegments.length > 0 && (
                      <span style={{ fontSize: 11, fontWeight: 500, marginLeft: 6, color: "#cbd5f5" }}>
                        {detailSegments.join(" | ")}
                      </span>
                    )}
                    {entry.simulationMode && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          marginLeft: 10,
                          color: "#fef08a",
                        }}
                      >
                        Design-Only Simulation
                      </span>
                    )}
                  </div>
                  {decision && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: decisionColor,
                        border: `1px solid ${decisionColor}55`,
                        borderRadius: 999,
                        padding: "2px 8px",
                        display: "inline-block",
                        marginBottom: 8,
                        textTransform: "uppercase",
                        letterSpacing: 0.8,
                      }}
                    >
                      {decision}
                    </span>
                  )}
                  <div
                    style={{
                      fontFamily: "Arimo, sans-serif",
                      fontSize: 11.25,
                      color: "#e5e5e5",
                      lineHeight: 1.5,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {entry.text}
                  </div>
                  {rationaleText && (
                    <div
                      style={{
                        marginTop: 6,
                        fontFamily: "Arimo, sans-serif",
                        fontSize: 11,
                        color: "#cbd5f5",
                        lineHeight: 1.5,
                      }}
                    >
                      {rationaleText}
                    </div>
                  )}
                  {ruleIds.length > 0 && (
                    <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {ruleIds.slice(0, 6).map((ruleId) => (
                        <span
                          key={`${entry.id}-${ruleId}`}
                          style={{
                            fontSize: 10,
                            color: "#fbbf24",
                            border: "1px solid #fbbf24",
                            borderRadius: 999,
                            padding: "2px 8px",
                          }}
                        >
                          {ruleId}
                        </span>
                      ))}
                    </div>
                  )}
                  {(metadata.provenance || metadata.citation || (metadata.urls && metadata.urls.length > 0)) && (
                    <div style={{ marginTop: 6, fontSize: 10.5, color: "#9ca3af", fontFamily: "Arimo, sans-serif" }}>
                      {metadata.provenance && <div>Provenance: {metadata.provenance}</div>}
                      {metadata.citation && <div>Citation: {metadata.citation}</div>}
                      {metadata.urls && metadata.urls.length > 0 && (
                        <div style={{ marginTop: 4 }}>
                          External Links:
                          <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                            {metadata.urls.map((url) => (
                              <li key={url} style={{ wordBreak: "break-all" }}>
                                {url}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                  {badges.length > 0 && (
                    <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {badges.map((badge) => (
                        <span
                          key={badge}
                          style={{
                            fontSize: 10,
                            fontFamily: "Arimo, sans-serif",
                            color: "#fbbf24",
                            border: "1px solid #fbbf24",
                            borderRadius: 999,
                            padding: "2px 8px",
                          }}
                        >
                          {badge}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
