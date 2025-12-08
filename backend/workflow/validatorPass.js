const { GOVERNANCE_DECISIONS } = require("./governanceConstants");
const { detectGovernanceViolations } = require("./detectGovernanceViolations");
const { applyOverridesToIssues } = require("./validatorOverrides");

const ACTIONABLE_PATTERNS = [
  /\b(deploy|execute|launch|ship|release|submit|file|implement|run|send|publish|approve|sign)\b/i,
  /\bbinding (commitment|decision|agreement)\b/i,
  /\boperational (procedure|step|instruction)\b/i,
  /\bfinal (offer|position|decision)\b/i,
];

function containsActionableLanguage(text = "") {
  const normalized = (text || "").toLowerCase();
  return ACTIONABLE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function computeStrictnessLevel(governanceStrictness) {
  if (typeof governanceStrictness === "number") return governanceStrictness;
  if (governanceStrictness && typeof governanceStrictness === "object") {
    if (typeof governanceStrictness.level === "number") return governanceStrictness.level;
    if (typeof governanceStrictness.value === "number") return governanceStrictness.value;
  }
  return 0;
}

function collectRuleIds(result = {}) {
  const ids = new Set();
  ["absoluteIssues", "contextualIssues", "softIssues"].forEach((key) => {
    (result[key] || []).forEach((issue) => {
      if (issue?.ruleId) ids.add(issue.ruleId);
    });
  });
  return Array.from(ids);
}

function collectForbiddenHits(result = {}, { unresolvedOnly = false } = {}) {
  const picks = [];
  (result.absoluteIssues || []).forEach((issue) => {
    if (unresolvedOnly && issue?.override) return;
    picks.push(issue?.evidence || issue?.rationale || issue?.ruleText || issue?.detector);
  });
  return picks.filter(Boolean);
}

function buildRationale({ qualityState, absoluteIssues = [], contextualIssues = [] }) {
  if (qualityState === "green") {
    return "Validator marked output compliant; no blocking governance findings.";
  }
  const lines = [];
  if (absoluteIssues.length) {
    lines.push(`Absolute issues: ${absoluteIssues.map((i) => i.ruleId || i.detector || i.id).join(", ")}`);
  }
  if (contextualIssues.length) {
    lines.push(`Contextual flags: ${contextualIssues.map((i) => i.ruleId || i.detector || i.id).join(", ")}`);
  }
  return lines.join(" | ") || "Validator generated QC findings.";
}

function summarizeValidation(result = {}, { qualityState }) {
  const absoluteCount = (result.absoluteIssues || []).filter((issue) => !issue.override).length;
  const contextualCount = (result.contextualIssues || []).filter((issue) => !issue.override).length;
  if (qualityState === "green") {
    return "QC state GREEN - no unresolved governance violations.";
  }
  if (absoluteCount) {
    return `QC state RED - ${absoluteCount} absolute issue(s) need correction.`;
  }
  if (contextualCount) {
    return "QC state YELLOW - contextual findings logged for review.";
  }
  return "QC state GREEN - overrides cleared all blocking findings.";
}


function enrichMetadata(existingMetadata, payload) {
  if (!existingMetadata || typeof existingMetadata !== "object") {
    return { validator: payload };
  }
  const merged = { ...existingMetadata };
  const priorValidator = merged.validator || {};
  merged.validator = { ...priorValidator, ...payload };
  return merged;
}

function rewriteAsSimulationSafe(text) {
  if (!text) return text;
  return text
    .replace(/\b(execute|deploy|finalize|implement)\b/gi, "[redacted — operational instruction removed]")
    .replace(/\b(should|must)\b/gi, "might");
}

async function validatorPass(
  text,
  {
    input,
    rules = [],
    governanceStrictness,
    hemisphere = "validator",
    governanceDecision = null,
    metadata = null,
    overrideRequest = null,
    sessionId = null,
    requestId = null,
    cycleState = null,
  } = {}
) {
  const strictnessLevel = computeStrictnessLevel(governanceStrictness);
  const detection = detectGovernanceViolations(text, {
    rules,
    context: { input, sessionId, requestId, hemisphere, strictnessLevel },
  });

  const overrideResult = applyOverridesToIssues(
    detection,
    overrideRequest || cycleState?.pendingValidatorOverride || null,
    { sessionId, requestId }
  );

  const unresolvedAbsolute = (detection.absoluteIssues || []).filter((issue) => !issue.override);
  const unresolvedContextual = (detection.contextualIssues || []).filter((issue) => !issue.override);

  let qualityState = "green";
  if (unresolvedAbsolute.length) {
    qualityState = "red";
  } else if (unresolvedContextual.length) {
    qualityState = "yellow";
  }

  const requiresCorrection = unresolvedAbsolute.length > 0;
  const requiresHumanReview = requiresCorrection || unresolvedContextual.length > 0;
  const rationale = buildRationale({
    qualityState,
    absoluteIssues: detection.absoluteIssues,
    contextualIssues: detection.contextualIssues,
  });
  const summary = summarizeValidation(detection, { qualityState });

  const mergedMetadata = enrichMetadata(metadata, {
    qualityState,
    requiresCorrection,
    requiresHumanReview,
    overrides: overrideResult.records || [],
  });

  const baseResult = {
    timestamp: new Date().toISOString(),
    hemisphere,
    strictnessLevel,
    qualityState,
    requiresCorrection,
    requiresHumanReview,
    absoluteIssues: detection.absoluteIssues,
    contextualIssues: detection.contextualIssues,
    softIssues: detection.softIssues,
    diagnostics: detection.diagnostics,
    assessmentLog: detection.assessmentLog,
    overrideRecords: overrideResult.records || [],
    finalText: detection.finalText || text,
    rationale,
    summary,
    ruleIds: collectRuleIds(detection),
    forbiddenHits: collectForbiddenHits(detection, { unresolvedOnly: true }),
    hardViolationCount: unresolvedAbsolute.length,
    decision: qualityState === "red" ? "fail" : qualityState === "yellow" ? "review" : "pass",
    isCompliant: !requiresCorrection,
    metadata: mergedMetadata,
  };

  const normalizedDecision =
    typeof governanceDecision === "string" ? governanceDecision.toLowerCase() : governanceDecision;
  const simulationActive =
    normalizedDecision === "simulation" ||
    cycleState?.governanceDecision?.outcome === GOVERNANCE_DECISIONS.SIMULATE_DESIGN_ONLY;

  if (simulationActive) {
    const rewritten = rewriteAsSimulationSafe(baseResult.finalText);
    baseResult.simulation = true;
    baseResult.simulationAdvisory = containsActionableLanguage(text)
      ? "Simulation mode: operational steps converted to conceptual guidance."
      : "Simulation mode: QC logging only; design-only output.";
    baseResult.finalText = rewritten;
    baseResult.decision = "pass";
    baseResult.isCompliant = true;
    baseResult.qualityState = baseResult.qualityState === "red" ? "yellow" : baseResult.qualityState;
    baseResult.requiresCorrection = false;
    baseResult.requiresHumanReview = false;
    baseResult.metadata = enrichMetadata(baseResult.metadata, {
      simulationMode: true,
      validatorMode: "simulation",
    });
  }

  return baseResult;
}

module.exports = {
  validatorPass,
};
