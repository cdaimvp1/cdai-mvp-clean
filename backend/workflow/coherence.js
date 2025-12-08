// V1.1-PHASE5: cycleState coherence enforcement
function ensureCycleStateCoherence(cycleState) {
  const REQUIRED = [
    "grammar",
    "normalizedRules",
    "constraints",
    "constraintSummary",
    "strictness",
    "envelope",
    "requestType",
    "governanceDecision",
    "governanceDecisionDetail",
  ];
  for (const k of REQUIRED) {
    if (!cycleState[k]) {
      console.warn("[V1.1-Coherence] Missing cycleState field:", k);
    }
  }
}

module.exports = { ensureCycleStateCoherence };
