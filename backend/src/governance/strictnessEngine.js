const DEFAULT_STRICTNESS_LEVEL = 2;

function isHighRiskTask(taskText = "") {
  const lower = (taskText || "").toLowerCase();
  const riskMarkers = ["legal", "contract", "policy", "audit", "regulator", "compliance", "obligation", "governance"];
  return riskMarkers.some((m) => lower.includes(m));
}

// STRICTNESS FEEDBACK FIX: provide bounded monotone tightening utilities
function tightenStrictness(base, increment = 0.05) {
  const b = Number(base) || 0;
  const inc = Number(increment) || 0;
  return Math.min(1, Math.max(0, b + inc));
}

function enforceStrictnessFloor(state) {
  if (!state) return 0;
  let strictness = state.strictnessLevel;
  if (!Number.isFinite(strictness)) {
    strictness = 0;
  }
  if (strictness < 0) strictness = 0;
  if (strictness > 4) strictness = 4;
  state.strictnessLevel = strictness;
  return state.strictnessLevel;
}

function escalateStrictness(state, delta) {
  if (!state) return 0;
  const increment = Number(delta) || 0;
  const baseline = Number(state.strictnessLevel);
  state.strictnessLevel = (Number.isFinite(baseline) ? baseline : 0) + increment;
  return enforceStrictnessFloor(state);
}

function evaluateStrictnessCycle(state, context = {}) {
  const workingState = { strictnessLevel: DEFAULT_STRICTNESS_LEVEL };
  const intentLabel = context.intent?.label || context.intent?.intent || context.intent || "";

  if (intentLabel.startsWith("rule_") || intentLabel === "governance_config") {
    if (workingState.strictnessLevel < 3) {
      workingState.strictnessLevel = 3;
    }
  }

  const combinedRulesCount = (context.rules || []).length + (context.taskLevelRules || []).length;
  const anyHighSeverity = []
    .concat(context.rules || [], context.taskLevelRules || [])
    .some((r) => (r?.severity || "").toLowerCase() === "high");
  if (combinedRulesCount > 5 || anyHighSeverity) {
    escalateStrictness(workingState, 1);
  }

  const anyHighRiskTask = (context.tasks || []).some((t) => isHighRiskTask(t));
  if (combinedRulesCount === 0 && (context.tasks || []).length === 1 && !anyHighRiskTask) {
    workingState.strictnessLevel -= 1;
    enforceStrictnessFloor(workingState);
  }
  if (anyHighRiskTask) {
    escalateStrictness(workingState, 1);
  }

  enforceStrictnessFloor(workingState);

  if (state) {
    state.strictnessLevel = workingState.strictnessLevel;
  }

  console.debug(`[Governance] Strictness level for this request: ${workingState.strictnessLevel}`);
  return workingState.strictnessLevel;
}

function normalizeStrictness(raw) {
  const f = Number(raw);
  if (!Number.isFinite(f)) return 0.85;
  return Math.min(1, Math.max(0, f));
}

module.exports = {
  evaluateStrictnessCycle,
  enforceStrictnessFloor,
  escalateStrictness,
  normalizeStrictness,
  tightenStrictness,
};
