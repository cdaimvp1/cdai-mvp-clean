import React from "react";
import { useGovernanceStore } from "../state/governanceStore";

const colorForStage = (stage: string | undefined) => {
  const lower = (stage || "").toLowerCase();
  if (lower.includes("analytical")) return "#4e7bff";
  if (lower.includes("moderator")) return "#d1a100";
  if (lower.includes("creative")) return "#6b46ff";
  return "#4e7bff";
};

export default function ArchivedLedgerPanel() {
  const archived = useGovernanceStore((s) => s.archivedSessions);

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
          gap: 12,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        {archived.length === 0 ? (
          <p style={{ fontFamily: "Arimo, sans-serif", fontSize: 11.5, color: "#9ca3af", margin: 0 }}>
            No archived ledger sessions yet.
          </p>
        ) : (
          archived.map((session) => (
            <div
              key={session.id}
              style={{
                border: "1px solid #1f1f1f",
                borderRadius: 8,
                padding: 10,
                background: "#0f0f0f",
              }}
            >
              <div
                style={{
                  fontFamily: "Arimo, sans-serif",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#e5e5e5",
                  marginBottom: 8,
                }}
              >
                Session {session.id} · {session.startedAt ? new Date(session.startedAt).toLocaleString() : "Unknown"} →{" "}
                {session.endedAt ? new Date(session.endedAt).toLocaleString() : "Active"}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Arimo, sans-serif" }}>
                  Data Scope:{" "}
                  <strong>{(session.dataScopeMode === "web" ? "Web" : "Work") || "Work"}</strong> Â· Strictness:
                  <strong>{session.strictnessLevel != null ? session.strictnessLevel : "n/a"}</strong>
                </div>
                {session.ledgerEvents.length === 0 ? (
                  <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Arimo, sans-serif" }}>No ledger entries.</div>
                ) : (
                  session.ledgerEvents.map((entry) => (
                    <div
                      key={entry.id}
                      style={{
                        display: "flex",
                        gap: 10,
                        borderLeft: `3px solid ${colorForStage(entry.stage || entry.text)}`,
                        paddingLeft: 10,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 6, fontFamily: "Arimo, sans-serif" }}>
                          {`${entry.timestamp || ""} ${entry.stage || ""} ${entry.cycle != null ? `Cycle ${entry.cycle}` : ""}`.trim()}
                        </div>
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
                      </div>
                    </div>
                  ))
                )}
                {(session.canonicalTrace?.core || session.canonicalTrace?.dataScope) && (
                  <div
                    style={{
                      marginTop: 8,
                      padding: "10px 12px",
                      border: "1px solid #1f1f1f",
                      borderRadius: 8,
                      background: "#090909",
                    }}
                  >
                    <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 6, fontFamily: "Arimo, sans-serif" }}>
                      Canonical Trace Snapshot
                    </div>
                    {session.canonicalTrace?.core && (
                      <div style={{ fontSize: 11, color: "#e5e5e5", marginBottom: 6 }}>
                        Decision: {session.canonicalTrace.core.governanceDecision || "n/a"}
                        <br />
                        Rationale: {session.canonicalTrace.core.rationale || "n/a"}
                      </div>
                    )}
                    {session.canonicalTrace?.dataScope && (
                      <div style={{ fontSize: 11, color: "#e5e5e5" }}>
                        Provenance: {session.canonicalTrace.dataScope.provenance || "n/a"}
                      </div>
                    )}
                  </div>
                )}
                {session.externalReferences && session.externalReferences.length > 0 && (
                  <div
                    style={{
                      marginTop: 8,
                      padding: "8px 10px",
                      border: "1px dashed #1f1f1f",
                      borderRadius: 8,
                      background: "#080808",
                    }}
                  >
                    <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 4, fontFamily: "Arimo, sans-serif" }}>
                      External References
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: "#e5e5e5" }}>
                      {session.externalReferences.slice(0, 8).map((ref) => (
                        <li key={ref} style={{ wordBreak: "break-all", marginBottom: 4 }}>
                          {ref}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {session.canonicalTraceHistory && session.canonicalTraceHistory.length > 0 && (
                  <div
                    style={{
                      marginTop: 8,
                      padding: "8px 10px",
                      border: "1px dashed #1f1f1f",
                      borderRadius: 8,
                      background: "#080808",
                    }}
                  >
                    <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 4, fontFamily: "Arimo, sans-serif" }}>
                      Trace History
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: "#e5e5e5" }}>
                      {session.canonicalTraceHistory
                        .slice()
                        .reverse()
                        .slice(0, 10)
                        .map((entry) => (
                          <li key={entry.timestamp} style={{ marginBottom: 4 }}>
                            {entry.timestamp} — Cycle {entry.cycle ?? "n/a"}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
