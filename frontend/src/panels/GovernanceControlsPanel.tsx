import React, { useEffect, useState } from "react";
import socket from "../socket";
import { useGovernanceStore } from "../state/governanceStore";

const labelStyle: React.CSSProperties = {
  fontFamily: "Arimo, sans-serif",
  fontSize: 12,
  fontWeight: 600,
  color: "#e5e5e5",
  letterSpacing: "0.05em",
};

const valueStyle: React.CSSProperties = {
  fontFamily: "Arimo, sans-serif",
  fontSize: 12,
  color: "#9ca3af",
};

const sliderTrackStyle: React.CSSProperties = {
  width: "100%",
  accentColor: "#007aff",
};

const pillStyle = (active: boolean): React.CSSProperties => ({
  padding: "8px 12px",
  borderRadius: 999,
  border: "1px solid #1f1f1f",
  background: active ? "#0a67d8" : "#1f1f1f",
  color: active ? "#e5e5e5" : "#9ca3af",
  fontFamily: "Arimo, sans-serif",
  fontSize: 12,
  cursor: "pointer",
  minWidth: 64,
  textAlign: "center",
  transition: "background 0.15s ease, color 0.15s ease",
});

export default function GovernanceControlsPanel() {
  const dataScopeMode = useGovernanceStore((s) => s.dataScopeMode);
  const governanceMode = useGovernanceStore((s) => s.governanceMode);
  const pendingClarification = useGovernanceStore((s) => s.pendingClarification);
  const latestNotice = useGovernanceStore((s) => s.governanceNotices[s.governanceNotices.length - 1]);
  const latestError = useGovernanceStore((s) => s.governanceErrors[s.governanceErrors.length - 1]);
  const governanceStrictnessSetting = useGovernanceStore((s) => s.governanceStrictnessSetting);
  const cycleLimitSetting = useGovernanceStore((s) => s.cycleLimitSetting);
  const perfMode = useGovernanceStore((s) => s.perfMode);
  const setGovernanceStrictnessSetting = useGovernanceStore((s) => s.setGovernanceStrictnessSetting);
  const setCycleLimitSetting = useGovernanceStore((s) => s.setCycleLimitSetting);
  const setPerfMode = useGovernanceStore((s) => s.setPerfMode);
  const [modePending, setModePending] = useState(false);
  const [governanceModePending, setGovernanceModePending] = useState(false);

  useEffect(() => {
    setModePending(false);
  }, [dataScopeMode]);

  useEffect(() => {
    setGovernanceModePending(false);
  }, [governanceMode]);

  const requestModeChange = (mode: "work" | "web") => {
    if (mode === dataScopeMode || modePending || pendingClarification) return;
    setModePending(true);
    socket.emit("set-data-scope-mode", mode);
  };

  const requestGovernanceModeChange = (mode: "strict" | "simulation" | "phi_compliant") => {
    if (mode === governanceMode || governanceModePending || pendingClarification) return;
    if (mode === "phi_compliant") return;
    setGovernanceModePending(true);
    socket.emit("set-governance-mode", mode);
  };

  const gridStyle: React.CSSProperties = {
    display: "grid",
    gap: 12,
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  };

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-lg h-full flex flex-col" style={{ overflow: "hidden" }}>
      <div className="px-4 py-3 border-b border-neutral-800 bg-neutral-950/60">
        <h3 className="font-['Arimo',sans-serif] text-[12px] text-neutral-50 tracking-[0.08em]">Governance Controls</h3>
      </div>
      <div className="flex-1 p-3 text-neutral-200 font-['Arimo',sans-serif] text-[11.5px] overflow-auto">
        <div style={{ ...gridStyle, alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={labelStyle}>Data Scope Mode</span>
              <span style={valueStyle}>{dataScopeMode === "web" ? "Web" : "Work"}</span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(["work", "web"] as const).map((mode) => {
                const active = dataScopeMode === mode;
                const disabled = !!pendingClarification || modePending;
                return (
                  <button
                    key={mode}
                    type="button"
                    style={{ ...pillStyle(active), opacity: disabled && !active ? 0.5 : 1 }}
                    onClick={() => requestModeChange(mode)}
                    disabled={disabled}
                    aria-pressed={active}
                  >
                    {mode === "work" ? "Work (Internal)" : "Web (External)"}
                  </button>
                );
              })}
            </div>
            {pendingClarification && (
              <p style={{ ...valueStyle, color: "#fbbf24", margin: 0 }}>Mode changes are blocked during clarification.</p>
            )}
            {latestNotice && (
              <p style={{ ...valueStyle, margin: "4px 0 0", color: "#7dd3fc" }}>
                Notice: {latestNotice.text} ({latestNotice.timestamp})
              </p>
            )}
            {latestError && (
              <p style={{ ...valueStyle, margin: "2px 0 0", color: "#f87171" }}>
                Error: {latestError.text} ({latestError.timestamp})
              </p>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={labelStyle}>Governance Strictness</span>
              <span style={valueStyle}>{governanceStrictnessSetting.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={governanceStrictnessSetting}
              onChange={(e) => setGovernanceStrictnessSetting(parseFloat(e.target.value))}
              style={sliderTrackStyle}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={labelStyle}>Cycle Limit</span>
              <span style={valueStyle}>{cycleLimitSetting === 0 ? "Off" : cycleLimitSetting}</span>
            </div>
            <input
              type="range"
              min={0}
              max={10}
              step={1}
              value={cycleLimitSetting}
              onChange={(e) => setCycleLimitSetting(parseInt(e.target.value, 10))}
              style={sliderTrackStyle}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={labelStyle}>Governance Mode</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {([
                { mode: "strict", label: "Strict" },
                { mode: "simulation", label: "Simulation" },
                { mode: "phi_compliant", label: "PHI-Compliant", disabled: true },
              ] as const).map(({ mode, label, disabled }) => {
                const active = governanceMode === mode;
                const isDisabled = disabled || governanceModePending || !!pendingClarification;
                return (
                  <button
                    key={mode}
                    type="button"
                    style={{ ...pillStyle(active), opacity: isDisabled && !active ? 0.5 : 1 }}
                    onClick={() => requestGovernanceModeChange(mode)}
                    disabled={isDisabled}
                    aria-pressed={active}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {pendingClarification && (
              <p style={{ ...valueStyle, color: "#fbbf24", margin: 0 }}>Mode changes are blocked during clarification.</p>
            )}
            {governanceMode === "phi_compliant" && (
              <p style={{ ...valueStyle, margin: "4px 0 0", color: "#f97316" }}>
                PHI-Compliant mode is reserved for future deployments.
              </p>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={labelStyle}>Performance Mode</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(["real", "fast", "turbo"] as const).map((mode) => (
                <button key={mode} style={pillStyle(perfMode === mode)} onClick={() => setPerfMode(mode)}>
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
