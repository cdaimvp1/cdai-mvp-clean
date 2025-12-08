import type { PanelId } from "./panelTypes";
import { getPanelDisplayName } from "./panelTypes";

type PanelIntentStatus = "none" | "match" | "ambiguous";

export interface PanelIntentMatch {
  panelId: PanelId;
  keyword: string;
  confidence: number;
}

export interface PanelIntentResult {
  status: PanelIntentStatus;
  panelId?: PanelId;
  matches: PanelIntentMatch[];
  utterance: string;
  reason?: string;
}

interface IntentContext {
  suggestedPanel?: PanelId | null;
  metadataHint?: string | null;
}

const ACTION_PATTERNS = [
  "open ",
  "show ",
  "bring up",
  "let me see",
  "display ",
  "pull up",
  "can i see",
];

const PANEL_SYNONYMS: Record<PanelId, string[]> = {
  governance: [
    "runtime governance panel",
    "runtime governance",
    "runtime panel",
    "governance panel",
    "governance view",
    "gov panel",
    "governance window",
    "logs panel",
    "error panel",
    "panel that displays errors",
    "event log panel",
  ],
  ledger: ["ledger", "ledger panel", "ledger view"],
  archivedLedger: ["archived ledger", "archive ledger"],
  rules: ["rules panel", "parsed rules", "rules view", "governance rules"],
  account: ["account panel", "account view", "account settings"],
  settings: ["settings panel", "system settings"],
  govControls: ["governance controls", "governance control panel", "controls panel"],
  govDiagnostics: [
    "governance diagnostics",
    "diagnostics panel",
    "runtime diagnostics",
    "governance telemetry panel",
  ],
  mvp: ["mvp demo", "demo panel"],
  constraints: [
    "constraint inspector",
    "constraint viewer",
    "constraints panel",
    "compliance rules panel",
    "constraint list",
  ],
  state: ["state inspector", "state panel", "state view", "system state panel"],
};

const AFFIRMATIVE_HINTS = ["yes", "sure", "please", "do it", "go ahead", "yep", "yeah", "open it"];
const NEGATIVE_HINTS = ["no", "nope", "stop", "cancel", "don't"];

const requiresActionPhrase = (text: string) => ACTION_PATTERNS.some((phrase) => text.includes(phrase));

const normalize = (text: string) => text.trim().toLowerCase();

function dedupeMatches(matches: PanelIntentMatch[]): PanelIntentMatch[] {
  const map = new Map<PanelId, PanelIntentMatch>();
  matches.forEach((match) => {
    const existing = map.get(match.panelId);
    if (!existing || match.confidence > existing.confidence) {
      map.set(match.panelId, match);
    }
  });
  return Array.from(map.values());
}

function computeConfidence(utterance: string, keyword: string) {
  let score = 0.6;
  if (utterance.includes(` ${keyword}`) || utterance.endsWith(keyword)) score += 0.2;
  if (utterance.includes(`${keyword} panel`)) score += 0.25;
  if (utterance.startsWith("open") || utterance.startsWith("show")) score += 0.1;
  if (utterance.includes("please")) score += 0.05;
  return Math.min(score, 0.95);
}

function resolvePanelFromHint(hint?: string | null): PanelId | null {
  if (!hint) return null;
  const lowered = hint.toLowerCase();
  for (const [panelId, synonyms] of Object.entries(PANEL_SYNONYMS)) {
    if (synonyms.some((token) => lowered.includes(token))) {
      return panelId as PanelId;
    }
  }
  return null;
}

export function detectPanelIntent(utterance: string, context: IntentContext = {}): PanelIntentResult {
  if (!utterance || typeof utterance !== "string") {
    return { status: "none", matches: [], utterance: "" };
  }
  const normalized = normalize(utterance);
  if (!normalized) {
    return { status: "none", matches: [], utterance: normalized };
  }

  const hasActionPhrase = requiresActionPhrase(normalized);
  if (!hasActionPhrase) {
    return { status: "none", matches: [], utterance: normalized, reason: "no-action-phrase" };
  }

  const matches: PanelIntentMatch[] = [];
  Object.entries(PANEL_SYNONYMS).forEach(([panelId, tokens]) => {
    tokens.forEach((token) => {
      if (normalized.includes(token)) {
        matches.push({
          panelId: panelId as PanelId,
          keyword: token,
          confidence: computeConfidence(normalized, token),
        });
      }
    });
  });

  let deduped = dedupeMatches(matches);

  if (!deduped.length && context.metadataHint) {
    const hintedPanel = resolvePanelFromHint(context.metadataHint);
    if (hintedPanel) {
      deduped = [{ panelId: hintedPanel, keyword: context.metadataHint, confidence: 0.5 }];
    }
  }

  if (!deduped.length && context.suggestedPanel) {
    deduped = [{ panelId: context.suggestedPanel, keyword: context.suggestedPanel, confidence: 0.4 }];
  }

  if (!deduped.length) {
    return { status: "ambiguous", matches: [], utterance: normalized, reason: "no-panel-match" };
  }

  if (deduped.length === 1) {
    return { status: "match", panelId: deduped[0].panelId, matches: deduped, utterance: normalized, reason: "single-match" };
  }

  return { status: "ambiguous", matches: deduped, utterance: normalized, reason: "multi-match" };
}

export function shouldConfirmPanelInvocation(result?: PanelIntentResult | null): boolean {
  if (!result || result.status !== "match") return true;
  const match = result.matches[0];
  return match.confidence < 0.75;
}

export function describePanelOptions(panelIds: PanelId[]): string {
  if (!panelIds.length) return "";
  if (panelIds.length === 1) return getPanelDisplayName(panelIds[0]);
  if (panelIds.length === 2) {
    return `${getPanelDisplayName(panelIds[0])} or ${getPanelDisplayName(panelIds[1])}`;
  }
  const names = panelIds.map((id) => getPanelDisplayName(id));
  return `${names.slice(0, -1).join(", ")}, or ${names[names.length - 1]}`;
}

export function classifyConfirmationResponse(text: string): "yes" | "no" | "unknown" {
  const normalized = normalize(text);
  if (!normalized) return "unknown";
  if (AFFIRMATIVE_HINTS.some((hint) => normalized === hint || normalized.startsWith(`${hint} `))) {
    return "yes";
  }
  if (NEGATIVE_HINTS.some((hint) => normalized === hint || normalized.startsWith(`${hint} `))) {
    return "no";
  }
  return "unknown";
}
