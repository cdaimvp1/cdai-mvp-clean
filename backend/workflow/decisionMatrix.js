// V1.1-PHASE3: deterministic governance decision matrix
const {
  REQUEST_TYPES,
  GOVERNANCE_DECISIONS,
  DATA_SCOPE_MODES,
  DEFAULT_DATA_SCOPE_MODE,
  GOVERNANCE_MODES,
} = require("./governanceConstants");

// V1.2-PHASE2: detect when grammar implies a web/public action
function requestAppearsToRequireWebAccess(grammar = {}) {
  const w = grammar?.semantics?.primaryVerb || "";
  const obj = grammar?.semantics?.primaryObject || "";
  const qualifiers = grammar?.semantics?.qualifiers || [];
  const tokens = Array.isArray(grammar?.tokens) ? grammar.tokens.join(" ") : "";
  const rawText = grammar?.rawText || "";
  const text = `${w} ${obj} ${qualifiers.join(" ")} ${tokens} ${rawText}`.toLowerCase();
  return /search|lookup|find|web|online|external|public/.test(text); // V1.2-PHASE5-FIX: inspect qualifiers + tokens for web intent
}

function evaluateGovernanceMatrix({
  requestType,
  strictness = { level: 0 },
  actionCategory = "other",
  constraints = [],
  constraintSummary = { hardBlock: false },
  grammar = { semantics: { riskMarkers: [] } },
  dataScopeMode = DEFAULT_DATA_SCOPE_MODE,
  allowWeb = dataScopeMode !== DATA_SCOPE_MODES.WORK,
  requestId = null,
  telemetry = null,
  governanceMode = GOVERNANCE_MODES.STRICT,
  isFictionalOrSynthetic = false,
  isSimulationHarness = false,
} = {}) {
  const summaryFlags = {
    webAccessForbidden: !!constraintSummary?.webAccessForbidden,
    citationRequired: !!constraintSummary?.citationRequired,
    provenanceRequired: !!constraintSummary?.provenanceRequired,
  };
  const requiresWeb = requestAppearsToRequireWebAccess(grammar);
  const telemetryBase = {
    event: "v1.2-matrix-eval",
    requestId,
    dataScopeMode,
    requiresWeb,
    summary: summaryFlags,
    governanceMode,
    simulationSignals: {
      isFictionalOrSynthetic: !!isFictionalOrSynthetic,
      isSimulationHarness: !!isSimulationHarness,
    },
  };
  const finalizeDecision = (decision) => {
    const adjusted = applySimulationOverride(decision, {
      governanceMode,
      isFictionalOrSynthetic,
      isSimulationHarness,
    });
    telemetry?.emit?.({
      ...telemetryBase,
      outcome: adjusted?.outcome,
      simulation: adjusted?.outcome === GOVERNANCE_DECISIONS.SIMULATE_DESIGN_ONLY,
    });
    return adjusted;
  };

  // Conversational or clarification traffic is always allowed
  if (
    requestType === REQUEST_TYPES.CONVERSATIONAL ||
    requestType === REQUEST_TYPES.CLARIFICATION_RESPONSE
  ) {
    return finalizeDecision({ outcome: GOVERNANCE_DECISIONS.ALLOW, rationale: "non-governed text" });
  }

  if (requestType === REQUEST_TYPES.UNKNOWN) {
    return finalizeDecision({
      outcome: GOVERNANCE_DECISIONS.ASK_CLARIFICATION,
      rationale: "request type not classifiable; clarification required",
    });
  }

  // No rules supplied for governed drafting
  if (
    requestType === REQUEST_TYPES.GOVERNED &&
    constraints.length === 0 &&
    (strictness?.level ?? 0) <= 1 &&
    (actionCategory === "drafting" || !actionCategory)
  ) {
    return finalizeDecision({
      outcome: GOVERNANCE_DECISIONS.REQUIRE_RULES,
      rationale: "governed request with no active rules",
    });
  }

  if (constraintSummary?.hardBlock) {
    return finalizeDecision({ outcome: GOVERNANCE_DECISIONS.BLOCK, rationale: "hard-block constraint active" });
  }

  if (!allowWeb && requiresWeb) {
    return finalizeDecision({
      outcome: GOVERNANCE_DECISIONS.BLOCK,
      rationale: "external data forbidden in work mode",
    });
  }

  if (summaryFlags.webAccessForbidden && requiresWeb) {
    return finalizeDecision({
      outcome: GOVERNANCE_DECISIONS.BLOCK,
      rationale: "explicit rule forbids web access",
    });
  }

  if (strictness?.level === 2) {
    if (actionCategory === "decision" || actionCategory === "execution") {
      return finalizeDecision({
        outcome: GOVERNANCE_DECISIONS.ASK_CLARIFICATION,
        rationale: "high-risk action requires clarification",
      });
    }
    const riskMarkers = grammar?.semantics?.riskMarkers || [];
    if (
      riskMarkers.some((m) =>
        ["execute", "deploy", "send", "approve", "finalize", "external"].includes(m)
      )
    ) {
      return finalizeDecision({
        outcome: GOVERNANCE_DECISIONS.ASK_CLARIFICATION,
        rationale: "risk markers detected under high strictness",
      });
    }
    return finalizeDecision({ outcome: GOVERNANCE_DECISIONS.ALLOW, rationale: "high strictness allowed" });
  }

  if (strictness?.level === 1) {
    return finalizeDecision({
      outcome: GOVERNANCE_DECISIONS.ALLOW,
      rationale: "medium strictness; no hard risk factors",
    });
  }

  return finalizeDecision({ outcome: GOVERNANCE_DECISIONS.ALLOW, rationale: "low strictness" });
}

function applySimulationOverride(
  decision,
  { governanceMode = GOVERNANCE_MODES.STRICT, isFictionalOrSynthetic = false, isSimulationHarness = false } = {}
) {
  if (!decision) return decision;
  const classificationSimulation = isFictionalOrSynthetic || isSimulationHarness;
  const governanceSimulationMode = governanceMode === GOVERNANCE_MODES.SIMULATION;
  const shouldSimulate =
    classificationSimulation ||
    (decision.outcome === GOVERNANCE_DECISIONS.BLOCK && governanceSimulationMode);
  if (!shouldSimulate) {
    return decision;
  }
  const rationale = decision.rationale
    ? `${decision.rationale} (design-only simulation override)`
    : "Design-only simulation override applied to governed simulation request.";
  return {
    ...decision,
    outcome: GOVERNANCE_DECISIONS.SIMULATE_DESIGN_ONLY,
    rationale,
    simulation: true,
  };
}

module.exports = { evaluateGovernanceMatrix };
