import type { ComponentType } from "react";
import RuntimeGovernancePanel from "./RuntimeGovernancePanel";
import LedgerPanel from "./LedgerPanel";
import ArchivedLedgerPanel from "./ArchivedLedgerPanel";
import ParsedRulesPanel from "./ParsedRulesPanel";
import AccountPanel from "./AccountPanel";
import SettingsPanel from "./SettingsPanel";
import GovernanceControlsPanel from "./GovernanceControlsPanel";
import MvpPanel from "./MVPDemoPanel";
import ConstraintInspectorPanel from "./ConstraintInspectorPanel";
import StateInspectorPanel from "./StateInspectorPanel";
import GovernanceDiagnosticsPanel from "./GovernanceDiagnosticsPanel.jsx";
import type { PanelId } from "./panelTypes";
export { panelDisplayNames, getPanelDisplayName } from "./panelTypes";
export type { PanelId } from "./panelTypes";

export const panelRegistry: Record<PanelId, ComponentType<any>> = {
  governance: RuntimeGovernancePanel,
  ledger: LedgerPanel,
  archivedLedger: ArchivedLedgerPanel,
  rules: ParsedRulesPanel,
  account: AccountPanel,
  settings: SettingsPanel,
  govControls: GovernanceControlsPanel,
  govDiagnostics: GovernanceDiagnosticsPanel,
  mvp: MvpPanel,
  constraints: ConstraintInspectorPanel,
  state: StateInspectorPanel,
};
