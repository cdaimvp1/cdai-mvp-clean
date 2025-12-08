export type PanelId =
  | "governance"
  | "ledger"
  | "archivedLedger"
  | "rules"
  | "account"
  | "settings"
  | "govControls"
  | "govDiagnostics"
  | "mvp"
  | "constraints"
  | "state";

export const panelDisplayNames: Record<PanelId, string> = {
  governance: "Runtime Governance",
  ledger: "Ledger",
  archivedLedger: "Archived Ledger",
  rules: "Parsed Governance Rules",
  account: "Account",
  settings: "Settings",
  govControls: "Governance Controls",
  govDiagnostics: "Governance Diagnostics",
  mvp: "MVP Demo",
  constraints: "Constraint Inspector",
  state: "State Inspector",
};

export function getPanelDisplayName(panelId: PanelId): string {
  return panelDisplayNames[panelId] || panelId.charAt(0).toUpperCase() + panelId.slice(1);
}
