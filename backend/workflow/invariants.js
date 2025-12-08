// V1-PHASE6: invariant helpers
function assertCycleStateShape(state, contextLabel = "unknown", options = {}) {
  const { requireAnalysisFields = true } = options;
  if (!state) {
    console.warn("[MCP][Invariant] Missing cycleState in", contextLabel);
    return;
  }
  if (!state.requestId) {
    console.warn("[MCP][Invariant] Missing requestId in cycleState", contextLabel);
  }
  if (!state.requestType) {
    console.warn("[MCP][Invariant] Missing requestType in cycleState", contextLabel);
  }
  if (!requireAnalysisFields) {
    return;
  }
  const analysisFields = [
    { key: "envelope", label: "envelope", requireObject: true },
    { key: "strictness", label: "strictness", requireObject: true },
    { key: "governanceDecision", label: "governanceDecision", requireObject: true },
    { key: "governanceDecisionDetail", label: "governanceDecisionDetail", requireObject: true },
    { key: "normalizedRules", label: "normalizedRules", requireLength: true },
    { key: "constraints", label: "constraints", requireLength: true },
    { key: "constraintSummary", label: "constraintSummary", requireObject: true },
  ];
  analysisFields.forEach(({ key, label, requireObject, requireLength }) => {
    const value = state[key];
    const missingObject = requireObject && (!value || typeof value !== "object");
    const missingList = requireLength && (!Array.isArray(value) || value.length === 0);
    if (missingObject || missingList) {
      console.warn(`[MCP][Invariant] Missing ${label} in cycleState (${contextLabel})`);
    }
  });
  if (state.constraints && !Array.isArray(state.constraints)) {
    console.warn("[MCP][Invariant] constraints should be an array in cycleState", contextLabel);
  }
}

// V1-PHASE6: helper for governance outcome checks
function isGovernedOutcome(decision) {
  if (!decision) return false;
  return (
    decision.outcome === "allow" ||
    decision.outcome === "ask_clarification" ||
    decision.outcome === "block" ||
    decision.outcome === "require_rules"
  );
}

function assertGovernanceDecision(decision, contextLabel = "unknown") {
  if (!decision) {
    console.warn("[MCP][Invariant] Missing governanceDecision in", contextLabel);
    return;
  }
  if (!isGovernedOutcome(decision)) {
    console.warn("[MCP][Invariant] Unknown governanceDecision.outcome:", decision.outcome, "in", contextLabel);
  }
}

module.exports = {
  assertCycleStateShape,
  assertGovernanceDecision,
  isGovernedOutcome,
};

// V1.1-PHASE5: constraint/grammar consistency validation
function validateSemanticCoherence(grammar, constraints) {
  const riskMarkers = grammar?.semantics?.riskMarkers || [];
  const hasHardBlock = (constraints || []).some((c) => c.type === "hard_block_action");
  return {
    riskMarkersDetected: riskMarkers.length > 0,
    hardBlockActive: hasHardBlock,
  };
}

module.exports.validateSemanticCoherence = validateSemanticCoherence;
