const {
  REQUEST_TYPES,
  GOVERNANCE_DECISIONS,
  DATA_SCOPE_MODES,
  DEFAULT_DATA_SCOPE_MODE,
} = require("./governanceConstants");

// V1-PHASE1A: structural enums local to this module
const MCP_EVENTS = {
  CYCLE_START: "mcp:cycle_start",
  ENTER_ANALYTICAL: "mcp:enter_analytical",
  ENTER_MODERATOR_1: "mcp:enter_moderator_1",
  ENTER_CREATIVE: "mcp:enter_creative",
  ENTER_MODERATOR_2: "mcp:enter_moderator_2",
  ENTER_VALIDATOR: "mcp:enter_validator",
  CYCLE_COMPLETE: "mcp:cycle_complete",
  CLARIFICATION_REQUIRED: "mcp:clarification_required",
  CLARIFICATION_RECEIVED: "mcp:clarification_received",
};

// V1.1-PHASE1: grammar-informed classification helpers
const {
  tokenize,
  parseTokens,
  semanticRoles,
} = require("./grammar");
// V1.1-PHASE2: rule normalizer imports
const {
  normalizeRules,
  deriveConstraints,
  mergeConstraints,
  evaluateConstraintAlgebra,
} = require("./ruleNormalizer");
const { classifyGovernanceRequest } = require("./governanceClassifier");

// V1-PHASE1A: parser scaffold
function parseUserInput(raw) {
  return {
    normalized: raw?.trim() ?? "",
    detectedCommands: [],
    flags: [],
    entities: [],
    errors: [],
  };
}

// V1-PHASE1A: envelope scaffold
// V1-PHASE2: envelope population
function buildEnvelope(request, context = {}) {
  const normalized = typeof request === "string" ? request : request?.normalized || "";
  const hasVerb = /\b(create|draft|analyze|summarize|write|generate|plan|build|design)\b/i.test(normalized);
  const detectIntent = (parsedInput = "") => {
    if (hasVerb) return "action";
    if ((parsedInput || "").includes("?")) return "inquiry";
    return "unknown";
  };
  const userIntent = detectIntent(normalized);
  const requestType = context.requestType || REQUEST_TYPES.UNGOVERNED;
  const timestamp = new Date().toISOString();
  // V1-PHASE4: action category on envelope
  const detectActionCategory = (parsedInput = "") => {
    const txt = (parsedInput || "").toLowerCase();
    if (/\b(write|draft|generate)\b/.test(txt)) return "drafting";
    if (/\b(analyze|compare|evaluate)\b/.test(txt)) return "analysis";
    if (/\b(approve|sign|finalize|decide)\b/.test(txt)) return "decision";
    if (/\b(execute|run|trigger|deploy)\b/.test(txt)) return "execution";
    if (/\b(fetch|retrieve|pull data|query)\b/.test(txt)) return "data_access";
    return "other";
  };
  const actionCategory = detectActionCategory(normalized);
  return {
    userIntent,
    safetyBands: { level: "low" },
    constraints: [],
    actionCategory,
    metadata: {
      timestamp,
      requestType,
      languageModel: "gpt-5.1",
    },
  };
}

// V1-PHASE4: strengthened strictness logic
function computeStrictness(_request, rules = [], envelope = {}) {
  const requestType = envelope.requestType || REQUEST_TYPES.UNGOVERNED;
  const actionCategory = envelope.actionCategory || "other";
  const constraints = envelope.constraints || [];
  if (requestType === REQUEST_TYPES.CONVERSATIONAL) {
    return { level: 0, rationale: "non-governed text" };
  }
  if (requestType === REQUEST_TYPES.CLARIFICATION_RESPONSE) {
    return { level: 0, rationale: "clarification flow" };
  }
  if (requestType === REQUEST_TYPES.UNKNOWN) {
    return { level: 1, rationale: "classification uncertain – defaulting to governed review" };
  }
  if (!rules || rules.length === 0) {
    return { level: 0, rationale: "no rules configured" };
  }
  const highRiskCategory = actionCategory === "decision" || actionCategory === "execution";
  const hasHardBlockConstraint = constraints.some((c) => c.type === "hard_block");
  if (hasHardBlockConstraint || highRiskCategory) {
    return {
      level: 2,
      rationale: hasHardBlockConstraint
        ? "hard block constraint present"
        : "decision/execution category under governance",
    };
  }
  return {
    level: 1,
    rationale: "governed with active rules",
  };
}

// V1-PHASE2: functional request classifier
function classifyRequest(rawInput, options = {}) {
  const simulationKeywords = [
    "draft",
    "simulation",
    "simulate",
    "design-only",
    "hypothetical",
    "template",
    "policy development",
    "position paper",
    "contract drafting",
    "analysis only",
    "risk assessment",
    "scenario",
    "review",
    "outline",
    "brainstorm",
  ];
  const lowerText = (rawInput || "").toLowerCase();
  if (simulationKeywords.some((k) => lowerText.includes(k))) {
    return {
      requestType: "governed",
      governanceDecision: "simulation",
      strictness: "high",
      metadata: { simulationMode: true },
    };
  }
  const result = classifyGovernanceRequest(rawInput, options);
  if (!result || !result.requestType) {
    return REQUEST_TYPES.UNKNOWN;
  }
  return result.requestType;
}

// V1-PHASE4: normalize constraints from parsed rules
function extractConstraintsFromRules(parsedRules = []) {
  const constraints = [];
  (parsedRules || []).forEach((rule) => {
    const text = (rule?.description || rule?.text || "").toLowerCase();
    const effect = (rule?.effect || rule?.action || "").toLowerCase();
    const id = rule?.id || rule?.ruleId;
    if (/block|deny|prohibit|forbid/.test(effect) || /do not proceed|never perform/.test(text)) {
      constraints.push({ type: "hard_block", sourceRuleId: id });
    }
    if (/approval|human review|requires approval/.test(text)) {
      constraints.push({ type: "requires_human_review", sourceRuleId: id });
    }
    if (/external\s+sharing|share externally/.test(text)) {
      constraints.push({ type: "no_external_sharing", sourceRuleId: id });
    }
    if (/production|prod/.test(text) && /execute|deploy|run/.test(text)) {
      constraints.push({ type: "no_production_execution", sourceRuleId: id });
    }
  });
  return constraints;
}

const hasHardBlockConstraintOrDenyRule = (rules = [], constraints = []) => {
  const hardConstraint = (constraints || []).some((c) => c.type === "hard_block");
  const denyRule = (rules || []).some((r) => /block|deny|prohibit|forbid/i.test(r?.effect || r?.action || r?.description || r?.text || ""));
  return hardConstraint || denyRule;
};

// V1.1-PHASE3: governance matrix wrapper
const { evaluateGovernanceMatrix } = require("./decisionMatrix");
function evaluateGovernance(requestType, rules = [], strictness = {}, envelope = {}, ctx = {}) {
  const {
    constraints = ctx.constraints || envelope?.constraints || [],
    constraintSummary = ctx.constraintSummary || { hardBlock: false },
    grammar = ctx.grammar || {},
    dataScopeMode = ctx.dataScopeMode,
    allowWeb = ctx.allowWeb,
    requestId = ctx.requestId,
    telemetry = ctx.telemetry,
    governanceMode = ctx.governanceMode,
    isFictionalOrSynthetic = ctx.isFictionalOrSynthetic,
    isSimulationHarness = ctx.isSimulationHarness,
  } = ctx;
  return evaluateGovernanceMatrix({
    requestType,
    strictness,
    actionCategory: envelope?.actionCategory,
    constraints,
    constraintSummary,
    grammar,
    dataScopeMode,
    allowWeb,
    requestId,
    telemetry,
    governanceMode,
    isFictionalOrSynthetic,
    isSimulationHarness,
  });
}

// V1-PHASE1A: cycle state shape
/**
 * CycleState {
 *   requestId: string
 *   requestType: REQUEST_TYPES
 *   strictness: object
 *   envelope: object
 *   parsedRules: any[]
 *   cycleStep: "A" | "M1" | "C" | "M2" | "V"
 * }
 */

// V1-PHASE1A: checkpoint scaffolds
function checkpointCycleState(state) {
  return { ...state };
}

function restoreCycleState(checkpoint) {
  return { ...checkpoint };
}

module.exports = {
  MCP_EVENTS,
  REQUEST_TYPES,
  GOVERNANCE_DECISIONS,
  DATA_SCOPE_MODES,
  DEFAULT_DATA_SCOPE_MODE,
  parseUserInput,
  buildEnvelope,
  computeStrictness,
  checkpointCycleState,
  restoreCycleState,
  classifyRequest,
  evaluateGovernance,
  extractConstraintsFromRules,
  GOVERNANCE_DECISIONS,
  REQUEST_TYPES,
  tokenize,
  parseTokens,
  semanticRoles,
  normalizeRules,
  deriveConstraints,
  mergeConstraints,
  evaluateConstraintAlgebra,
};
