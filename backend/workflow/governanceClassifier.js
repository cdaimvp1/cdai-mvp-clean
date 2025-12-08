const { REQUEST_TYPES } = require("./governanceConstants");

const CLASSIFIER_VERSION = "deterministic-v1";

const SENSITIVITY_MARKERS = [
  {
    id: "sensitivity.phi",
    pattern: /\b(phi|hipaa|patient chart|clinical record|treatment plan|diagnosis|medical record)\b/i,
    detail: "Protected health information or HIPAA-governed terminology",
  },
  {
    id: "sensitivity.pii",
    pattern: /\b(ssn|social security|passport|driver'?s license|personally identifiable|pii)\b/i,
    detail: "Personally identifiable data reference",
  },
  {
    id: "sensitivity.financial",
    pattern: /\b(pci|cardholder|bank account|earnings release|sox|sarbanes|balance sheet)\b/i,
    detail: "Financial data subject to PCI/SOX handling",
  },
];

const COMPLIANCE_PATTERNS = [
  {
    id: "compliance.regulation",
    pattern: /\b(gdpr|ccpa|regulatory|compliance plan|audit trail|policy control|risk register)\b/i,
    detail: "Regulatory or compliance reference",
  },
];

const ARCHITECTURE_PATTERNS = [
  {
    id: "architecture.system_design",
    pattern: /\b(architecture|system design|reference architecture|blueprint|control plane|service mesh|platform design)\b/i,
    detail: "System/architecture design intent",
  },
];

const WORKFLOW_PATTERNS = [
  {
    id: "workflow.orchestration",
    pattern: /\b(runbook|workflow|orchestration|agent mesh|multi-agent|pipeline|playbook|mcp)\b/i,
    detail: "Workflow/agent-orchestration request",
  },
];

const DATA_GOVERNANCE_PATTERNS = [
  {
    id: "governance.data_controls",
    pattern: /\b(data (retention|classification|catalog|lineage|minimization|masking|tokenization)|access control|governance policy)\b/i,
    detail: "Data governance control request",
  },
];

const SAFETY_ENVELOPE_PATTERNS = [
  {
    id: "safety.release",
    pattern: /\b(deploy|release|ship|publish|push to prod|production run|approve release|send externally)\b/i,
    detail: "Production or external release trigger",
  },
];

const SIMULATION_KEYWORDS = [
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
  "example",
  "guidance",
  "briefing document",
  "governance analysis",
];
const SIMULATION_PATTERN = new RegExp(
  `\\b(${SIMULATION_KEYWORDS.map((kw) => kw.replace(/[-/\\\\^$*+?.()|[\\]{}]/g, "\\$&")).join("|")})\\b`,
  "i"
);

const INFORMATIONAL_PREFIXES = ["what", "who", "when", "where", "why", "how", "should", "could", "would", "explain", "define"];
const PLEASANTRY_PHRASES = ["hi", "hello", "thanks", "thank you", "good morning", "good afternoon", "good evening", "appreciate it", "sounds good", "cool", "great"];

function collectMatches(patterns, text) {
  if (!text) return [];
  return patterns
    .filter((marker) => marker.pattern.test(text))
    .map((marker) => ({ id: marker.id, detail: marker.detail }));
}

function extractFeatures(rawInput) {
  const normalized = typeof rawInput === "string" ? rawInput.trim() : "";
  const lower = normalized.toLowerCase();
  const tokens = lower.split(/\s+/).filter(Boolean);
  const startsWithInformational = INFORMATIONAL_PREFIXES.some((prefix) => lower.startsWith(`${prefix} `));
  const endsWithQuestion = normalized.endsWith("?");
  const isQuestion = startsWithInformational || endsWithQuestion;
  const directiveVerbs = /\b(create|draft|design|build|develop|implement|configure|orchestrate|deploy|release|ship|approve|audit|plan|architect|enforce|analyze)\b/i;
  const isDirective = directiveVerbs.test(lower);
  const pleasantry = PLEASANTRY_PHRASES.some((phrase) => lower === phrase || lower.startsWith(`${phrase} `));
  const shortAck = tokens.length > 0 && tokens.length <= 3 && /\b(ok|okay|yes|no|sure|fine|great|thanks)\b/.test(lower);
  const simulationFlag = SIMULATION_PATTERN.test(lower);

  const sensitivityMatches = collectMatches(SENSITIVITY_MARKERS, lower);
  const complianceMatches = collectMatches(COMPLIANCE_PATTERNS, lower);
  const architectureMatches = collectMatches(ARCHITECTURE_PATTERNS, lower);
  const workflowMatches = collectMatches(WORKFLOW_PATTERNS, lower);
  const dataGovernanceMatches = collectMatches(DATA_GOVERNANCE_PATTERNS, lower);
  const safetyMatches = collectMatches(SAFETY_ENVELOPE_PATTERNS, lower);

  const hasGovernedSignal =
    [
      sensitivityMatches,
      complianceMatches,
      architectureMatches,
      workflowMatches,
      dataGovernanceMatches,
      safetyMatches,
    ].some((arr) => arr.length > 0) || isDirective;

  const isInformational = isQuestion && !isDirective && !hasGovernedSignal;
  const isPleasantry = pleasantry || shortAck;

  return {
    normalized,
    lower,
    tokens,
    isQuestion,
    isDirective,
    isInformational,
    isPleasantry,
    simulationFlag,
    sensitivityMatches,
    complianceMatches,
    architectureMatches,
    workflowMatches,
    dataGovernanceMatches,
    safetyMatches,
    hasGovernedSignal,
  };
}

const GOVERNED_CRITERIA = [
  {
    id: "criterion.sensitivity",
    category: "sensitivity",
    strictness: 2,
    evaluate: (features) =>
      features.sensitivityMatches.length > 0
        ? `Protected data markers: ${features.sensitivityMatches.map((m) => m.detail).join("; ")}`
        : false,
  },
  {
    id: "criterion.compliance",
    category: "compliance",
    strictness: 2,
    evaluate: (features) =>
      features.complianceMatches.length > 0
        ? `Compliance references: ${features.complianceMatches.map((m) => m.detail).join("; ")}`
        : false,
  },
  {
    id: "criterion.architecture",
    category: "architecture",
    strictness: 1,
    evaluate: (features) =>
      features.architectureMatches.length > 0
        ? `Architecture intent: ${features.architectureMatches.map((m) => m.detail).join("; ")}`
        : false,
  },
  {
    id: "criterion.workflow",
    category: "workflow",
    strictness: 1,
    evaluate: (features) =>
      features.workflowMatches.length > 0
        ? `Workflow orchestration request: ${features.workflowMatches.map((m) => m.detail).join("; ")}`
        : false,
  },
  {
    id: "criterion.data-governance",
    category: "data_governance",
    strictness: 1,
    evaluate: (features) =>
      features.dataGovernanceMatches.length > 0
        ? `Data governance controls requested: ${features.dataGovernanceMatches.map((m) => m.detail).join("; ")}`
        : false,
  },
  {
    id: "criterion.safety-envelope",
    category: "safety",
    strictness: 2,
    evaluate: (features) =>
      features.safetyMatches.length > 0 ? `Safety envelope trigger: ${features.safetyMatches[0].detail}` : false,
  },
];

const UNGOVERNED_CRITERIA = [
  {
    id: "criterion.informational",
    category: "informational",
    evaluate: (features) =>
      features.isInformational ? "Informational/knowledge-seeking question" : false,
  },
  {
    id: "criterion.pleasantry",
    category: "conversation",
    evaluate: (features) =>
      features.isPleasantry ? "Conversation/acknowledgement without governance impact" : false,
  },
];

function classifyGovernanceRequest(rawInput, options = {}) {
  const features = extractFeatures(rawInput || "");
  const governedFactors = [];
  GOVERNED_CRITERIA.forEach((criterion) => {
    const detail = criterion.evaluate(features);
    if (detail) {
      governedFactors.push({
        id: criterion.id,
        category: criterion.category,
        detail,
        strictness: criterion.strictness,
      });
    }
  });

  const ungovernedFactors = [];
  UNGOVERNED_CRITERIA.forEach((criterion) => {
    const detail = criterion.evaluate(features);
    if (detail) {
      ungovernedFactors.push({
        id: criterion.id,
        category: criterion.category,
        detail,
        strictness: 0,
      });
    }
  });

  const simulationMode = features.simulationFlag;

  let requestType = REQUEST_TYPES.UNKNOWN;
  if (simulationMode) {
    requestType = REQUEST_TYPES.GOVERNED;
  } else if (governedFactors.length > 0) {
    requestType = REQUEST_TYPES.GOVERNED;
  } else if (ungovernedFactors.length > 0) {
    requestType = REQUEST_TYPES.UNGOVERNED;
  }

  const governingFactors = [...governedFactors, ...ungovernedFactors].map((factor) => ({
    id: factor.id,
    category: factor.category,
    detail: factor.detail,
  }));

  if (simulationMode) {
    governingFactors.push({
      id: "signal.simulation",
      category: "simulation",
      detail: "Fictional/synthetic scenario detected",
    });
  }

  if (governingFactors.length === 0) {
    governingFactors.push({
      id: "classification.none",
      category: "classification",
      detail: "No deterministic blueprint criteria matched",
    });
  }

  const strictnessLevel = simulationMode
    ? 3
    : governedFactors.reduce(
        (max, factor) => Math.max(max, factor.strictness || 1),
        governedFactors.length > 0 ? 1 : 0
      );

  const requiredStrictness =
    requestType === REQUEST_TYPES.GOVERNED
      ? {
          level: strictnessLevel || 1,
          rationale: simulationMode
            ? "Design-only/simulation drafting requires high strictness."
            : `Governed criteria matched: ${governedFactors.map((f) => f.id).join(", ")}`,
        }
      : requestType === REQUEST_TYPES.UNGOVERNED
      ? { level: 0, rationale: "Informational or conversational request" }
      : { level: 1, rationale: "Unknown request type requires baseline review" };

  return {
    requestType,
    governingFactors,
    requiredStrictness,
    governanceDecision: simulationMode ? "simulation" : null,
    simulationFlag: simulationMode,
    metadata: {
      entrypoint: options.entrypoint || "governanceClassifier",
      classifierVersion: CLASSIFIER_VERSION,
      tokensAnalyzed: features.tokens.length,
      simulationMode: simulationMode || undefined,
    },
  };
}

module.exports = { classifyGovernanceRequest };
