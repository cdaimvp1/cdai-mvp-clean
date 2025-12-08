import React, { useMemo, useState, useEffect, useRef, useLayoutEffect } from "react";
import { useGovernanceStore } from "../state/governanceStore";

type TimelineEntry = {
  id: string;
  text?: string;
  timestamp?: string;
  cycle?: number;
  decision?: string;
  hemisphere?: string;
  strictness?: number | string | null;
  ruleIds?: string[];
  rationale?: string;
};

interface PassDefinition {
  key: string;
  title: string;
  stage: string;
  accent: string;
  logs: TimelineEntry[];
  emptyText: string;
}

interface DetailSectionDefinition {
  key: string;
  title: string;
  entries: TimelineEntry[];
  empty: string;
  accent: string;
}

const panelSurfaceStyle: React.CSSProperties = {
  height: "100%",
  display: "flex",
  flexDirection: "column",
  padding: 18,
  background: "rgba(6,6,6,0.9)",
  color: "#f8fafc",
  fontFamily: "Arimo, sans-serif",
  borderRadius: 10,
  border: "1px solid rgba(148,163,184,0.18)",
  boxShadow: "0 12px 32px rgba(0,0,0,0.55)",
  gap: 16,
  overflow: "hidden",
  overflowY: "auto",
  minHeight: 0,
};

const passCardStyle: React.CSSProperties = {
  borderRadius: 12,
  border: "1px solid rgba(148,163,184,0.25)",
  background: "rgba(12,12,12,0.92)",
  padding: 14,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  minHeight: 220,
  height: "100%",
  maxHeight: 360,
  overflow: "hidden",
};

const timelineTextStyle: React.CSSProperties = {
  fontSize: 11.5,
  color: "#e2e8f0",
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
};

const timestampStyle: React.CSSProperties = {
  fontSize: 10,
  color: "#94a3b8",
};

const emptyTextStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#6b7280",
};

const chevronStyle: React.CSSProperties = {
  transition: "transform 160ms ease",
  display: "inline-flex",
};

const gridCardStyle: React.CSSProperties = {
  borderRadius: 12,
  border: "1px solid rgba(148,163,184,0.22)",
  background: "rgba(10,10,10,0.95)",
  padding: 14,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  minHeight: 160,
  height: "100%",
  overflow: "hidden",
};

const scrollListStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  overflowY: "auto",
  paddingRight: 4,
  scrollbarWidth: "thin",
};

interface ScrollableLogListProps {
  entries: TimelineEntry[];
  emptyText: string;
  maxHeight?: number;
}

const GOVERNANCE_DETAILS_MAX_HEIGHT = 420;

const ScrollableLogList = ({ entries, emptyText, maxHeight }: ScrollableLogListProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [entries]);

  if (!entries.length) {
    return <span style={emptyTextStyle}>{emptyText}</span>;
  }

  return (
    <div
      ref={containerRef}
      style={{
        ...scrollListStyle,
        flex: 1,
        minHeight: 0,
        maxHeight,
      }}
    >
      {entries.map((entry) => {
        const entryKey = entry.id || `${entry.timestamp || "ts"}-${entry.text?.slice(0, 16) || "entry"}`;
        return (
          <div key={entryKey} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {entry.timestamp && <span style={timestampStyle}>{entry.timestamp}</span>}
            <span style={timelineTextStyle}>{entry.text || "No detail provided."}</span>
          </div>
        );
      })}
    </div>
  );
};

const PassCard = ({ title, accent, status, logs, emptyText }: PassDefinition & { status?: string }) => (
  <div style={{ ...passCardStyle, borderTop: `3px solid ${accent}` }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: 0.5 }}>{title}</span>
      {status && (
        <span
          style={{
            fontSize: 10,
            padding: "2px 8px",
            borderRadius: 999,
            border: `1px solid ${accent}`,
            color: accent,
            textTransform: "uppercase",
            letterSpacing: 0.6,
          }}
        >
          {status}
        </span>
      )}
    </div>
    <ScrollableLogList entries={logs} emptyText={emptyText} />
  </div>
);

const decisionBadgeStyle = {
  fontSize: 10,
  fontWeight: 700,
  padding: "2px 8px",
  borderRadius: 999,
  textTransform: "uppercase",
  letterSpacing: 0.8,
};

const ValidatorEntryRow = ({ entry }: { entry: TimelineEntry }) => {
  const [expanded, setExpanded] = useState(false);
  const rationale = entry.rationale || entry.text || "No rationale provided.";
  const needsToggle = rationale.length > 220;
  const displayText = expanded || !needsToggle ? rationale : `${rationale.slice(0, 220)}…`;
  const decision = (entry.decision || "").toLowerCase();
  const decisionColor =
    decision === "pass" ? "#22c55e" : decision === "fail" ? "#ef4444" : "rgba(226,232,240,0.9)";
  const timestamp = entry.timestamp || "No timestamp";
  const strictnessLabel =
    typeof entry.strictness === "number" || typeof entry.strictness === "string"
      ? entry.strictness
      : "—";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "8px 10px",
        borderRadius: 8,
        background: "rgba(15,15,15,0.9)",
        border: "1px solid rgba(148,163,184,0.18)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <span style={{ ...timestampStyle, fontSize: 10.5 }}>{timestamp}</span>
        {entry.decision && (
          <span style={{ ...decisionBadgeStyle, border: `1px solid ${decisionColor}`, color: decisionColor }}>
            {entry.decision.toUpperCase()}
          </span>
        )}
      </div>
      <div style={{ fontSize: 11.5, color: "#cbd5f5", display: "flex", gap: 12, flexWrap: "wrap" }}>
        <span>
          Hemisphere: <strong>{entry.hemisphere || "Validator"}</strong>
        </span>
        <span>
          Strictness: <strong>{strictnessLabel}</strong>
        </span>
      </div>
      {Array.isArray(entry.ruleIds) && entry.ruleIds.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {entry.ruleIds.slice(0, 6).map((ruleId) => (
            <span
              key={`${entry.id}-${ruleId}`}
              style={{
                border: "1px solid rgba(248,250,252,0.2)",
                borderRadius: 999,
                padding: "2px 8px",
                fontSize: 10,
                color: "#fbbf24",
              }}
            >
              {ruleId}
            </span>
          ))}
        </div>
      )}
      <div style={{ fontSize: 11.5, color: "#e2e8f0", lineHeight: 1.5 }}>
        {displayText}
        {needsToggle && (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            style={{
              marginLeft: 8,
              fontSize: 10.5,
              color: "#93c5fd",
              background: "transparent",
              border: "none",
              cursor: "pointer",
            }}
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
      </div>
    </div>
  );
};

const ValidatorLogList = ({ entries, emptyText }: { entries: TimelineEntry[]; emptyText: string }) => {
  if (!entries.length) {
    return <span style={emptyTextStyle}>{emptyText}</span>;
  }
  return (
    <div style={{ ...scrollListStyle, maxHeight: 220 }}>
      {entries.map((entry) => {
        const entryKey = entry.id || `${entry.timestamp || "ts"}-validator`;
        return <ValidatorEntryRow key={entryKey} entry={entry} />;
      })}
    </div>
  );
};

const ValidatorPassCard = ({
  title,
  accent,
  status,
  logs,
  emptyText,
}: PassDefinition & { status?: string }) => (
  <div style={{ ...passCardStyle, borderTop: `3px solid ${accent}` }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: 0.5 }}>{title}</span>
      {status && (
        <span
          style={{
            ...decisionBadgeStyle,
            border: `1px solid ${accent}`,
            color: accent,
          }}
        >
          {status}
        </span>
      )}
    </div>
    <ValidatorLogList entries={logs} emptyText={emptyText} />
  </div>
);

const getLatestEntry = (entries: TimelineEntry[]) => entries[entries.length - 1] || null;

const summarizeEntry = (entry: TimelineEntry | null, fallback: string) => {
  if (!entry) return fallback;
  const text = entry.rationale || entry.text || fallback;
  const singleLine = text.replace(/\s+/g, " ").trim();
  return singleLine.length > 120 ? `${singleLine.slice(0, 117)}…` : singleLine;
};

const CompactPassView = ({
  passes,
  cycleStatus,
  isTwoColumn,
}: {
  passes: PassDefinition[];
  cycleStatus: string;
  isTwoColumn: boolean;
}) => {
  const layoutStyle: React.CSSProperties = isTwoColumn
    ? { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }
    : { display: "flex", flexDirection: "column", gap: 12 };

  return (
    <div style={layoutStyle}>
      {passes.map((pass) => {
        const latest = getLatestEntry(pass.logs);
        const timestamp = latest?.timestamp || "No recent updates";
        const summary = summarizeEntry(latest, pass.emptyText);
        return (
          <div
            key={pass.key}
            style={{
              border: "1px solid rgba(148,163,184,0.25)",
              borderLeft: `3px solid ${pass.accent}`,
              borderRadius: 10,
              padding: "10px 12px",
              background: "rgba(12,12,12,0.92)",
              display: "flex",
              flexDirection: "column",
              gap: 6,
              minHeight: 90,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{pass.title}</span>
              {cycleStatus === pass.stage && (
                <span
                  style={{
                    fontSize: 10,
                    color: pass.accent,
                    border: `1px solid ${pass.accent}66`,
                    borderRadius: 999,
                    padding: "1px 6px",
                    textTransform: "uppercase",
                    letterSpacing: 0.6,
                  }}
                >
                  Active
                </span>
              )}
            </div>
            <span style={{ ...timestampStyle, fontSize: 10.5 }}>{timestamp}</span>
            <span style={{ fontSize: 11.5, color: "#e2e8f0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {summary}
            </span>
          </div>
        );
      })}
    </div>
  );
};

const CompactGovernanceDetails = ({
  sections,
  isTwoColumn,
}: {
  sections: DetailSectionDefinition[];
  isTwoColumn: boolean;
}) => {
  const layoutStyle: React.CSSProperties = isTwoColumn
    ? { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }
    : { display: "flex", flexDirection: "column", gap: 12 };

  return (
    <div style={layoutStyle}>
      {sections.map((section) => {
        const latest = getLatestEntry(section.entries);
        const summary = summarizeEntry(latest, section.empty);
        const timestamp = latest?.timestamp || "No recent events";
        return (
          <div
            key={section.key}
            style={{
              border: "1px solid rgba(148,163,184,0.22)",
              borderLeft: `3px solid ${section.accent}`,
              borderRadius: 10,
              padding: "10px 12px",
              background: "rgba(8,8,8,0.94)",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8 }}>
              {section.title}
            </span>
            <span style={{ ...timestampStyle, fontSize: 10.5 }}>{timestamp}</span>
            <span style={{ fontSize: 11, color: "#e2e8f0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {summary}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default function RuntimeGovernancePanel() {
  const cycleStatus = useGovernanceStore((s) => s.cycleStatus);
  const analyticalOutput = useGovernanceStore((s) => s.analyticalOutput ?? s.analyticalLog ?? []);
  const moderatorOutputPre = useGovernanceStore((s) => s.moderatorOutputPre ?? s.moderatorLog ?? []);
  const moderatorOutputPost = useGovernanceStore((s) => s.moderatorOutputPost ?? []);
  const creativeOutput = useGovernanceStore((s) => s.creativeOutput ?? s.creativeLog ?? []);
  const validatorOutput = useGovernanceStore((s) => s.validatorOutput ?? s.validationEvents ?? []);
  const validationSignals = useGovernanceStore((s) => s.validationSignals ?? s.validationEvents ?? []);
  const governanceNotices = useGovernanceStore((s) => s.governanceNotices);
  const deliveryWarnings = useGovernanceStore((s) => s.deliveryWarnings);
  const deliveryFailures = useGovernanceStore((s) => s.deliveryFailures);

  const [isExpanded, setIsExpanded] = useState(false);
  const [forcedByAlert, setForcedByAlert] = useState(false);
  const detailContentRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [detailContentHeight, setDetailContentHeight] = useState(0);
  const [panelWidth, setPanelWidth] = useState(0);

  useLayoutEffect(() => {
    if (!panelRef.current) return;
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        setPanelWidth(entries[0].contentRect.width);
      }
    });
    observer.observe(panelRef.current);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!detailContentRef.current) return;
    const measure = () => {
      const container = detailContentRef.current;
      if (!container) return;
      const measured = container.scrollHeight || 0;
      setDetailContentHeight(Math.min(measured, GOVERNANCE_DETAILS_MAX_HEIGHT));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(detailContentRef.current);
    return () => observer.disconnect();
  }, [
    panelWidth,
    governanceNotices.length,
    validationSignals.length,
    deliveryWarnings.length,
    deliveryFailures.length,
    isExpanded,
  ]);

  useEffect(() => {
    if (deliveryFailures.length > 0) {
      setIsExpanded(true);
      setForcedByAlert(true);
    } else if (forcedByAlert) {
      setForcedByAlert(false);
    }
  }, [deliveryFailures.length, forcedByAlert]);

  const passCards: PassDefinition[] = useMemo(
    () => [
      {
        key: "analytical",
        title: "Analytical Pass",
        stage: "Analytical",
        accent: "#4e7bff",
        logs: analyticalOutput,
        emptyText: "Analytical guidance pending.",
      },
      {
        key: "moderator",
        title: "Moderator Pass",
        stage: "Moderator",
        accent: "#f5a524",
        logs: moderatorOutputPre,
        emptyText: "No moderator checkpoints recorded yet.",
      },
      {
        key: "creative",
        title: "Creative Pass",
        stage: "Creative",
        accent: "#a855f7",
        logs: creativeOutput,
        emptyText: "Creative pass has not produced output yet.",
      },
      {
        key: "moderatorPost",
        title: "Moderator (Post-Creative)",
        stage: "Moderator",
        accent: "#f97316",
        logs: moderatorOutputPost,
        emptyText: "Post-creative governance review pending.",
      },
      {
        key: "validator",
        title: "Validator Pass",
        stage: "Validator",
        accent: "#22c55e",
        logs: validatorOutput,
        emptyText: "Validator has not emitted any signals yet.",
      },
    ],
    [analyticalOutput, creativeOutput, moderatorOutputPost, moderatorOutputPre, validatorOutput]
  );

  const detailSections: DetailSectionDefinition[] = useMemo(
    () => [
      {
        key: "notices",
        title: "Governance Notices",
        entries: governanceNotices,
        empty: "No governance notices have been recorded.",
        accent: "#fbbf24",
      },
      {
        key: "validation",
        title: "Validation Signals",
        entries: validationSignals,
        empty: "No validator signals available.",
        accent: "#ef4444",
      },
      {
        key: "warnings",
        title: "Delivery Warnings",
        entries: deliveryWarnings,
        empty: "No delivery warnings issued.",
        accent: "#fb923c",
      },
      {
        key: "failures",
        title: "Delivery Failures",
        entries: deliveryFailures,
        empty: "No delivery failures detected.",
        accent: "#b91c1c",
      },
    ],
    [deliveryFailures, deliveryWarnings, governanceNotices, validationSignals]
  );

  const isCompact = panelWidth > 0 && panelWidth < 900;
  const compactPassTwoColumn = panelWidth >= 600 && panelWidth < 900;
  const compactDetailTwoColumn = panelWidth >= 600 && panelWidth < 900;

  const fullDetailColumns =
    panelWidth >= 1200 ? "repeat(4, minmax(0, 1fr))" : panelWidth >= 768 ? "repeat(2, minmax(0, 1fr))" : "repeat(1, minmax(0, 1fr))";

  const toggleDetails = () => {
    if (forcedByAlert && deliveryFailures.length > 0 && isExpanded) {
      setForcedByAlert(false);
      setIsExpanded(false);
      return;
    }
    setForcedByAlert(false);
    setIsExpanded((prev) => !prev);
  };

  return (
    <div ref={panelRef} style={panelSurfaceStyle}>
      {isCompact ? (
        <CompactPassView passes={passCards} cycleStatus={cycleStatus} isTwoColumn={compactPassTwoColumn} />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 14,
            alignItems: "stretch",
          }}
        >
          {passCards.map((card) =>
            card.key === "validator" ? (
              <ValidatorPassCard
                key={card.key}
                {...card}
                status={cycleStatus === card.stage ? "Active" : undefined}
              />
            ) : (
              <PassCard
                key={card.key}
                {...card}
                status={cycleStatus === card.stage ? "Active" : undefined}
              />
            )
          )}
        </div>
      )}

      <div
        style={{
          borderRadius: 12,
          border: "1px solid rgba(148,163,184,0.22)",
          background: "rgba(10,10,10,0.98)",
          overflow: "hidden",
        }}
      >
        <button
          type="button"
          onClick={toggleDetails}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            background: "transparent",
            border: "none",
            color: "#f1f5f9",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: 0.4,
            cursor: "pointer",
          }}
        >
          <span>Governance Details</span>
          <span style={{ ...chevronStyle, transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}>▸</span>
        </button>
        <div
          style={{
            overflow: "hidden",
            transition: "max-height 320ms ease, opacity 220ms ease",
            maxHeight: isExpanded ? detailContentHeight + 32 : 0,
            opacity: isExpanded ? 1 : 0,
            pointerEvents: isExpanded ? "auto" : "none",
          }}
        >
          <div
            ref={detailContentRef}
            style={{
              padding: 16,
              maxHeight: GOVERNANCE_DETAILS_MAX_HEIGHT,
              overflowY: "auto",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 16,
              }}
            >
              {isCompact ? (
                <CompactGovernanceDetails sections={detailSections} isTwoColumn={compactDetailTwoColumn} />
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: fullDetailColumns,
                    gap: 16,
                    alignItems: "stretch",
                  }}
                >
                  {detailSections.map((section) => (
                    <div
                      key={section.key}
                      style={{
                        ...gridCardStyle,
                        borderTop: `3px solid ${section.accent}`,
                        background: "rgba(8,8,8,0.94)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>
                          {section.title}
                        </span>
                        {section.key === "failures" && deliveryFailures.length > 0 && (
                          <span
                            style={{
                              fontSize: 10,
                              color: section.accent,
                              border: `1px solid ${section.accent}44`,
                              borderRadius: 999,
                              padding: "2px 6px",
                              textTransform: "uppercase",
                              letterSpacing: 0.8,
                            }}
                          >
                            {deliveryFailures.length} issue{deliveryFailures.length === 1 ? "" : "s"}
                          </span>
                        )}
                      </div>
                      <div style={{ flex: 1, minHeight: 0 }}>
                        <ScrollableLogList entries={section.entries} emptyText={section.empty} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
