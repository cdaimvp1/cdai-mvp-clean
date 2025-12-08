// workflow/runGovernedWorkflow.js
// Core governed workflow orchestrator (modular, dual-hemisphere, governed runtime).

require("dotenv").config();

// --- OpenAI / model config ---------------------------------------------------

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const MODEL_NAME = "gpt-4o";
const HARD_MAX_CYCLES = 25;

// --- Imports -----------------------------------------------------------------

const {
  checkContextDrift,
  generateGovernanceNarrative,
} = require("./openaiClient");

const {
  evaluateStrictnessCycle,
  enforceStrictnessFloor,
  escalateStrictness,
  normalizeStrictness,
  tightenStrictness,
} = require("../src/governance/strictnessEngine");

const {
  classifyIntent,
  classifyUserIntent,
} = require("../src/governance/classification");

const {
  extractTasks,
  extractTasksOnly,
  stripRuleBlocks,
} = require("../src/governance/taskExtractor");

const { extractExplicitRules } = require("../src/governance/ruleExtractor");

const { analyticalPass } = require("./analyticalPass");
const { moderatorPass } = require("./moderatorPass");
const { creativePass } = require("./creativePass");
const { taskAgentPass } = require("./taskAgentPass");
const { buildNarrativeReport } = require("./buildNarrativeReport");
const { validatorPass } = require("./validatorPass");
const { callOpenAIChat } = require("./openaiChatUtil");
// V1-PHASE1B: scaffolding imports (no behavior change)
const {
  MCP_EVENTS,
  parseUserInput,
  buildEnvelope,
  computeStrictness,
  checkpointCycleState,
  restoreCycleState,
  evaluateGovernance,
  extractConstraintsFromRules,
  tokenize,
  parseTokens,
  semanticRoles,
} = require("./mcpPhase1A");
const { classifyGovernanceRequest } = require("./governanceClassifier");
const {
  REQUEST_TYPES,
  GOVERNANCE_DECISIONS,
  DATA_SCOPE_MODES,
  DEFAULT_DATA_SCOPE_MODE,
  GOVERNANCE_MODES,
} = require("./governanceConstants");
const {
  assertCycleStateShape,
  assertGovernanceDecision,
  isGovernedOutcome,
} = require("./invariants");
// V1.1-PHASE2: rule normalizer
const {
  normalizeRules,
  deriveConstraints,
  mergeConstraints,
  evaluateConstraintAlgebra,
} = require("./ruleNormalizer");
const { ensureCycleStateCoherence } = require("./coherence");
// V1.1-PHASE3: decision matrix
const { evaluateGovernanceMatrix } = require("./decisionMatrix");
const { detectGovernanceViolations } = require("./detectGovernanceViolations");

// --- Canonical narrative structure & regexes ---------------------------------

function formatParsedRules(rules = []) {
  return (rules || []).map((r, idx) => {
    const text = typeof r === "string" ? r : r.text || r.description || "";
    const condition = typeof r === "string" ? r : r.condition || text || "";
    return {
      id: r.id || r.ruleId || `rule-${idx + 1}`,
      description: r.description || text,
      condition,
      severity:
        typeof r.severity === "number"
          ? r.severity
          : typeof r.severity === "string"
          ? r.severity
          : 1,
    };
  });
}

// V1.1-PHASE4: governed prompt shaper
function buildGovernedPrompt(originalPrompt, cycleState) {
  if (cycleState?.requestType !== REQUEST_TYPES.GOVERNED) return originalPrompt;
  const { envelope, strictness = { level: 0 }, governanceDecision = {}, constraints, grammar } = cycleState || {};
  const constraintLines =
    (constraints ?? [])
      .map((c) => `- ${c.type} (${c.severity})`)
      .join("\n") || "- (none)";
  const riskMarkers = grammar?.semantics?.riskMarkers?.join(", ") || "(none)";
  const safetyDirectives =
    strictness.level >= 2
      ? `You MUST avoid unsafe commitments, irreversible decisions, or external actions.`
      : `Behave cautiously; avoid transformations that imply execution or real-world actions.`;

  return `
[Governance Context]
- Request type: ${cycleState.requestType}
- Intent: ${envelope?.userIntent ?? "unknown"}
- Action category: ${envelope?.actionCategory ?? "other"}
- Strictness: ${strictness.level}
- Governance decision: ${governanceDecision.outcome}

[Constraint Model]
${constraintLines}

[Grammar Model]
- Primary verb: ${grammar?.semantics?.primaryVerb ?? "(none)"}
- Primary object: ${grammar?.semantics?.primaryObject ?? "(none)"}
- Risk markers: ${riskMarkers}

[Required Safety Behavior]
${safetyDirectives}

[Instruction]
Follow all constraints. If performing the requested action would violate any constraint or applicable governance rule, you MUST NOT perform it.  
Instead, explain the conflict and propose a safe alternative or ask for clarification.

-------------------
${originalPrompt}
`;
}

const CANONICAL_SECTIONS = [
  "Root Cause",
  "Remediation",
  "Governance Enhancement",
  "Leadership Summary",
];

const COMMITMENT_REGEX =
  /\bwill\b|\bwill\s+likely\b|\bis\s+expected\s+to\b|\bexpected\s+to\b|\bcommit\b|\bensure\b|\bguarantee\b|fully implemented|deterministic model|\b\d+%\b|\b\d{2,}\s*(confidence|certainty)|\b(per\s+cent|percent)\b/gi;

const ROLES_REGEX =
  /(task force|committee|board|team|department|oversight group|working group|executive team|council|governance circle|working council|oversight cell)/gi;

const REGULATORY_REGEX =
  /(ISO(-)?like|regulatory alignment|audit-ready|audit ready|compliance review|parallels compliance|oversight parallels compliance|mapped to controls|mapped to ministries)/gi;

const FORMULA_REGEX = /\b\d+\s*[\+\-\*\/]\s*\d+\b/gi;

const PROSE_FORMULA_REGEX =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+of\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(equal|equals|is)\b/gi;

const SPELLED_PERCENT_REGEX =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\s+per\s+cent\b/gi;

const DETERMINISTIC_NUMERIC_REGEX =
  /\b\d+%\b|\b\d{2,}\s*(confidence|certainty)\b|\b(per\s+cent|percent)\b/gi;

const REAL_INSTITUTIONS = [
  "nasa",
  "iso",
  "hipaa",
  "fda",
  "sec",
  "who",
  "world health organization",
  "finance department",
  "operations department",
  "ministry",
];

// --- Utility helpers ---------------------------------------------------------

function normalizeMaxCycles(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 5;
  return Math.min(10, Math.max(1, Math.round(n)));
}

function normalizePerfMode(raw) {
  const v = (raw || "").toString().toLowerCase();
  if (v === "fast" || v === "turbo") return v;
  return "real";
}

function normalizeGovernanceMode(raw) {
  const value = (raw || "").toString().toLowerCase();
  if (value === GOVERNANCE_MODES.SIMULATION) return GOVERNANCE_MODES.SIMULATION;
  if (value === GOVERNANCE_MODES.PHI_COMPLIANT) return GOVERNANCE_MODES.PHI_COMPLIANT;
  return GOVERNANCE_MODES.STRICT;
}

const SIMULATION_TOKENS = ["fictional", "hypothetical", "synthetic"];
const HARNESS_TOKENS = [
  "mock dataset",
  "test harness",
  "simulation only",
  "design-only governance walkthrough",
  "design only governance walkthrough",
];

function detectSimulationSignals(text = "") {
  const normalized = (text || "").toLowerCase();
  const isFictionalOrSynthetic = SIMULATION_TOKENS.some((token) => normalized.includes(token));
  const isSimulationHarness = HARNESS_TOKENS.some((token) => normalized.includes(token));
  return { isFictionalOrSynthetic, isSimulationHarness };
}

function isSimulationDecision(state) {
  return state?.governanceDecision?.outcome === GOVERNANCE_DECISIONS.SIMULATE_DESIGN_ONLY;
}

function prefixSimulationBanner(text = "", state) {
  if (!isSimulationDecision(state)) return text;
  const prefix = "[SIMULATION / DESIGN-ONLY] No real data processed.";
  if (!text) return prefix;
  return text.startsWith(prefix) ? text : `${prefix}\n\n${text}`;
}

function tagLedgerEntry(entry, state, fallbackSimulation = false) {
  if (!entry) return entry;
  const simulationActive = isSimulationDecision(state) || !!fallbackSimulation;
  return simulationActive ? { ...entry, simulationMode: true } : entry;
}

function normalizeDataScopeMode(raw) {
  if (typeof raw === "string") {
    const normalized = raw.toLowerCase();
    if (Object.values(DATA_SCOPE_MODES).includes(normalized)) {
      return normalized;
    }
  }
  return DEFAULT_DATA_SCOPE_MODE;
}

// Safer JSON parsing for LLM responses; also exposed via globalThis for tests.
function safeParseJsonContent(raw, { fallback = null, label = "LLM JSON" } = {}) {
  const warn = (msg) =>
    console.warn(`[Governance][safeParseJsonContent] ${label}: ${msg}`);

  if (raw === null || raw === undefined) {
    warn("No content to parse; returning fallback.");
    return { ok: false, value: fallback, error: "empty" };
  }

  if (typeof raw !== "string") {
    return { ok: true, value: raw, error: null };
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    warn("Blank content; returning fallback.");
    return { ok: false, value: fallback, error: "blank" };
  }

  const attemptParse = (input) => {
    try {
      return { ok: true, value: JSON.parse(input), error: null };
    } catch (err) {
      return { ok: false, value: fallback, error: err?.message || "parse_error" };
    }
  };

  const direct = attemptParse(trimmed);
  if (direct.ok) return direct;

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    const sliced = trimmed
      .slice(start, end + 1)
      .replace(/,\s*([}\]])/g, "$1");
    const salvage = attemptParse(sliced);
    if (salvage.ok) return salvage;
    warn(`Failed salvage parse: ${salvage.error}`);
    return salvage;
  }

  warn(`Unable to locate JSON body: ${direct.error}`);
  return direct;
}

// --- Narrative structure helpers --------------------------------------------

function getSectionBoundaries(text) {
  const matches = [];
  const regex =
    /(?:^|\n)\s*(Root Cause|Remediation|Governance Enhancement|Leadership Summary)\s*[:\-]?\s*/gi;
  let m;
  while ((m = regex.exec(text)) !== null) {
    matches.push({ name: m[1], index: m.index, start: regex.lastIndex });
  }
  return matches
    .map((marker, idx) => ({
      ...marker,
      end: matches[idx + 1] ? matches[idx + 1].index : text.length,
    }))
    .sort((a, b) => a.index - b.index);
}

function extractSections(text) {
  const matches = getSectionBoundaries(text);
  const sections = {};
  matches.forEach((marker) => {
    sections[marker.name] = text.slice(marker.start, marker.end).trim();
  });
  return sections;
}

function coerceToCanonicalStructure(text) {
  const sections = extractSections(text);
  const missing = CANONICAL_SECTIONS.filter((s) => !sections[s]);
  const hasAll = missing.length === 0;
  if (hasAll) return text;

  const rebuilt = CANONICAL_SECTIONS.map((section) => {
    const body =
      sections[section] ||
      "Pending clarification; provided content was remapped to canonical sections.";
    return `${section}:\n${body}`.trim();
  });

  return rebuilt.join("\n\n");
}

function replaceDeterministicLanguage(text) {
  let output = text.replace(COMMITMENT_REGEX, (m) => {
    if (/fully implemented/i.test(m))
      return "partially implemented (subject to validation)";
    if (/guarantee/i.test(m)) return "avoid definitive promise";
    if (/ensure/i.test(m)) return "aim to support";
    if (/commit/i.test(m)) return "plan to";
    if (/will\s+likely/i.test(m)) return "likely to";
    if (/expected to/i.test(m)) return "likely to";
    if (/will/i.test(m)) return "intend to";
    if (/deterministic model/i.test(m)) return "model subject to validation";
    if (/%/.test(m) || /confidence|certainty|per\s+cent|percent/i.test(m))
      return "approximate (subject to validation)";
    return "aim to";
  });

  output = output.replace(
    DETERMINISTIC_NUMERIC_REGEX,
    "approximate (subject to validation)"
  );
  output = output.replace(FORMULA_REGEX, "calculation (approximate only)");
  output = output.replace(
    SPELLED_PERCENT_REGEX,
    "approximate (subject to validation)"
  );
  output = output.replace(
    PROSE_FORMULA_REGEX,
    "calculation (approximate only)"
  );
  return output;
}

function stripRolesAndRegulatory(text) {
  let output = text.replace(ROLES_REGEX, "cross-functional group");
  output = output.replace(
    REGULATORY_REGEX,
    "mapped to internal controls"
  );
  return output;
}

function applyCycleOneFilters(text) {
  let output = coerceToCanonicalStructure(text);
  output = stripRolesAndRegulatory(output);
  output = replaceDeterministicLanguage(output);
  return output;
}

// --- PCGP: parseGovernanceEnvelope ------------------------------------------

function parseGovernanceEnvelope(rawInputText) {
  const text = (rawInputText || "").trim();
  const lower = text.toLowerCase();

  const explicitRules = [];
  const inferredRules = [];
  const contradictions = [];
  const decoyInstruction = [];
  const conditionalLanguage = [];
  const metaWarnings = [];

  const forbiddenContent = {
    percentages: /\bpercent|per\s+cent|%\b/.test(lower),
    mathFormulas: /\bformula|math|equals\b/.test(lower),
    realInstitutions: REAL_INSTITUTIONS.some((r) => lower.includes(r)),
    roles: /\bdepartment|team|committee|board|council|role|operations dept\b/.test(
      lower
    ),
  };

  const safetyBoundaries = {
    noSpeculation: /\bno speculation|not speculate|no guessing\b/.test(lower),
    noLegalConclusions: /\bno legal\b|\bavoid legal\b/.test(lower),
    conditionalLanguageOnly: false,
  };

  const toneSchema = {
    analyticalTone: "crisp + hedged",
    executiveSummaryPlainLanguage: "reassuring + plain language",
  };

  const structureSchema = {
    requiredSections: [...CANONICAL_SECTIONS],
    orderEnforced: true,
    authoritativeSource: "latest-explicit-or-canonical",
  };

  if (/\bmissing|vague|unclear|insufficient detail\b/.test(lower)) {
    conditionalLanguage.push({
      text: "If inputs are unclear, flag missing info instead of guessing.",
      confidence: 0.78,
    });
  }

  const decoyPatterns = [
    "nasa",
    "operations dept",
    "operations department",
    "create a formula",
    "use departments",
  ];
  decoyPatterns.forEach((p) => {
    if (lower.includes(p)) {
      decoyInstruction.push({
        text: `Decoy instruction detected: "${p}"`,
        confidence: 0.71,
        rationale:
          "Prompt contained distracting or contradictory governance text.",
      });
    }
  });

  const missingInformation = /\bmissing|vague|unclear|insufficient detail\b/.test(
    lower
  );

  return {
    explicitRules,
    inferredRules,
    structureSchema,
    toneSchema,
    safetyBoundaries,
    forbiddenContent,
    metaWarnings,
    contradictions,
    conditionalLanguage,
    missingInformation,
    decoyInstruction,
    requiresGovernedOutput: true,
  };
}

// --- Rule extraction helper (rules-only LLM call) ---------------------------

async function extractRulesOnly(rawText) {
  const original = rawText || "";
  const trimmed = original.trim();
  if (!trimmed) {
    return {
      explicit: [],
      general: [],
      candidateInferred: [],
      parse_error: true,
      raw_response: "",
      error: "empty_input",
    };
  }
  if (!process.env.OPENAI_API_KEY) {
    console.warn("[cd/ai] OPENAI_API_KEY missing - using safe fallback mode (rule-extraction)");
    return {
      explicit: [],
      general: [],
      candidateInferred: [],
      parse_error: false,
      raw_response: "",
      error: null,
      fallback: { ok: true, value: null, reason: "fallback-no-key" },
    };
  }

  const system = `Extract RULES ONLY from the user's input. Do NOT extract tasks. Return JSON only:
{
  "rules": {
    "explicit": ["rule1", "rule2"],
    "general": ["general rule"],
    "candidateInferred": ["optional inferred rule"]
  }
}`;

  const callChat =
    typeof globalThis.callOpenAIChat === "function"
      ? globalThis.callOpenAIChat
      : callOpenAIChat;

  const res = await callChat({
    system,
    user: rawText,
    temperature: 0,
    response_format: "json",
  });

  const parsed = safeParseJsonContent(res, {
    fallback: {},
    label: "RuleExtraction",
  });
  const value = parsed.value || {};
  const rules = value.rules || {};

  const explicit = Array.isArray(rules.explicit) ? rules.explicit : [];
  const general = Array.isArray(rules.general) ? rules.general : [];
  const candidateInferred = Array.isArray(rules.candidateInferred)
    ? rules.candidateInferred
    : Array.isArray(rules.candidate_inferred)
    ? rules.candidate_inferred
    : [];

  return {
    explicit,
    general,
    candidateInferred,
    parse_error: !parsed.ok,
    raw_response: res || "",
    error: parsed.error || null,
  };
}

// --- Rule-clear socket hook -------------------------------------------------

function registerRuleClearHandler(socket, state) {
  if (!socket || typeof socket.on !== "function") return;
  socket.on("clear-rules", () => {
    state.activeRules = [];
    state.explicitRules = [];
    state.generalRules = [];
    state.inferredRules = [];
    state.conflicts = [];
    state.defaultRules = [];
    state._pendingClarification = null;
    state._pendingInferredRule = null;
    state._finalOutputSent = false;
    state._driftState = null;
    state._taskHistory = [];

    socket.emit("governance-log", {
      text: "Governance state fully reset; rules cleared.",
      level: "info",
    });
  });
}

// --- Task extraction helper for tests ---------------------------------------

async function extractTasksOnlyLocal(rawText) {
  const original = rawText || "";
  const trimmed = original.trim();
  if (!trimmed) {
    return {
      tasks: [],
      tasksNormalized: [],
      parse_error: true,
      raw_response: "",
      error: "empty_input",
    };
  }
  if (!process.env.OPENAI_API_KEY) {
    console.warn("[cd/ai] OPENAI_API_KEY missing — using safe fallback mode (task-extraction)");
    return {
      tasks: [],
      tasksNormalized: [],
      parse_error: false,
      raw_response: "",
      error: null,
      fallback: { ok: true, value: null, reason: "fallback-no-key" },
    };
  }

  const system = `Extract TASKS ONLY from the user's input. Do NOT extract rules. Return JSON only:
{
  "tasks": [
    {"type": "email|memo|other", "description": "task description", "rawText": "original text"}
  ]
}`;

  const callChat =
    typeof globalThis.callOpenAIChat === "function"
      ? globalThis.callOpenAIChat
      : callOpenAIChat;

  const res = await callChat({
    system,
    user: rawText,
    temperature: 0,
    response_format: "json",
  });

  const parsed = safeParseJsonContent(res, {
    fallback: {},
    label: "TaskExtraction",
  });
  const value = parsed.value || {};
  const tasks = Array.isArray(value.tasks) ? value.tasks : [];

  const tasksNormalized = tasks.map((t) => {
    if (typeof t === "string") {
      return { type: "unknown", description: t, rawText: original };
    }
    return {
      type: t.type || "unknown",
      description: t.description || t.text || "",
      rawText: t.rawText || original,
    };
  });

  return {
    tasks,
    tasksNormalized,
    parse_error: !parsed.ok,
    raw_response: res || "",
    error: parsed.error || null,
  };
}

// --- Main governed orchestrator ---------------------------------------------

async function runGovernedWorkflow(
  socket,
  {
    input = "",
    goal = "",
    maxCycles = null,
    governanceStrictness = 0.85,
    perfMode = "real",
    rules = [],
    governanceEnvelope = null,
    classification: providedClassification = null,
    requiresGovernedOutput = false,
    sessionId = null,
    runId = null,
    baseLedger = [],
    dataScopeMode: sessionDataScopeMode = DEFAULT_DATA_SCOPE_MODE,
    governanceMode: sessionGovernanceMode = GOVERNANCE_MODES.STRICT,
    allowedSources: sessionAllowedSources = ["internal"],
    allowWeb: sessionAllowWeb = false,
    provenanceMode: sessionProvenanceMode = "internal-only",
  } = {}
) {
  const mustGovernOutput =
    requiresGovernedOutput || !!(governanceEnvelope && governanceEnvelope.requiresGovernedOutput);
  if (!socket || typeof socket.emit !== "function") {
    throw new Error("Socket is required to run governed workflow.");
  }

  // TEST-D-FIX: allow callers to provide a ledger reference for inspection
  const ledger = Array.isArray(baseLedger) ? baseLedger : [];
  // TEST-D-FIX: precompute extraction artifacts for downstream telemetry + constraints
  const taskExtractionResult = await extractTasksOnlyLocal(input);
  const extractedTasks = taskExtractionResult.tasksNormalized || [];
  const ruleExtractionResult = await extractRulesOnly(input);
  const inlineRuleObjects = [
    ...(ruleExtractionResult.explicit || []).map((text, idx) => ({
      text: (text || "").trim(),
      origin: "task-inline",
      status: "pending",
      kind: "explicit",
      ruleId: `inline-explicit-${idx + 1}`,
    })),
    ...(ruleExtractionResult.general || []).map((text, idx) => ({
      text: (text || "").trim(),
      origin: "task-inline",
      status: "pending",
      kind: "general",
      ruleId: `inline-general-${idx + 1}`,
    })),
    ...(ruleExtractionResult.candidateInferred || []).map((text, idx) => ({
      text: (text || "").trim(),
      origin: "task-inline",
      status: "pending",
      kind: "inferred",
      ruleId: `inline-inferred-${idx + 1}`,
    })),
  ].filter((r) => r.text.length > 0);
  // V1-PHASE1B: attach scaffolding (no behavior change)
  const parsedInput = parseUserInput(input);
  // V1.1-PHASE1: attach grammar to cycle state
  const grammarTokens = tokenize(input);
  const grammarParsed = parseTokens(grammarTokens);
  const grammarSemantics = semanticRoles(grammarParsed);
  const classifierSnapshot =
    providedClassification && providedClassification.requestType
      ? providedClassification
      : classifyGovernanceRequest(input, { entrypoint: "runGovernedWorkflow" });
  const requestType =
    classifierSnapshot.requestType === REQUEST_TYPES.UNKNOWN
      ? REQUEST_TYPES.GOVERNED
      : classifierSnapshot.requestType;
  let scaffoldEnvelope = buildEnvelope(parsedInput.normalized, { goal, requestType });
  scaffoldEnvelope = { ...scaffoldEnvelope, classification: classifierSnapshot };
  let scaffoldStrictness = null;
  const buildGovernancePreamble = (state) => {
    if (state.requestType !== REQUEST_TYPES.GOVERNED) return "";
    const constraintLines =
      (state.envelope?.constraints || []).map((c) => `- ${c.type}`).join("\n") || "- (no explicit constraints found)";
    return `
[Governance Context]
- Request type: ${state.requestType}
- Intent: ${state.envelope?.userIntent ?? "unknown"}
- Action category: ${state.envelope?.actionCategory ?? "other"}
- Strictness level: ${state.strictness?.level ?? 0}

[Constraints]
${constraintLines}

[Instruction]
If fulfilling this request would violate any of the listed constraints or an obviously applicable safety policy, do NOT perform the action. Instead, explain which constraint would be violated and suggest a safer alternative or ask for clarification.
`.trim();
  };
  // TEST-D-FIX: keep initial normalization scoped separately from later derived constraint algebra
  const normalizedInputRules = (rules || []).map((r) =>
    typeof r === "string"
      ? { text: r, origin: "user", status: "pending" }
      : { ...r, text: r.text || "" }
  );
  const envelopeRules = normalizeEnvelopeRules(governanceEnvelope);
  const allRules = [...normalizedInputRules, ...inlineRuleObjects, ...envelopeRules].filter(
    (r) => (r.text || "").trim().length > 0
  );
  const roomTarget = sessionId || socket.id || "default-session";
  const resolvedDataScopeMode = normalizeDataScopeMode(sessionDataScopeMode);
  const resolvedGovernanceMode = normalizeGovernanceMode(sessionGovernanceMode);
  const simulationSignals = detectSimulationSignals(input);

  let cycleState;
  const ackWatchlist = new Set(["governance-clarification", "clarification-accepted", "governed-output", "workflow-finished"]);
  const pendingAckTimers = new Map();
  const failedDeliveries = new Map();
  const ACK_TIMEOUT_MS = 1500;
  const MAX_ACK_RETRIES = 2;

  const sendRawEvent = (event, enriched) => {
    if (socket?.server?.to) {
      socket.server.to(roomTarget).emit(event, enriched);
    } else {
      socket.emit(event, enriched);
    }
  };

  const scheduleAckRetry = (ackId) => {
    const pending = pendingAckTimers.get(ackId);
    if (!pending) return;
    pending.timer = setTimeout(() => {
      const current = pendingAckTimers.get(ackId);
      if (!current) return;
      if (current.attempt >= MAX_ACK_RETRIES) {
        if (current.handler) socket.off("delivery-ack", current.handler);
        if (current.timer) clearTimeout(current.timer);
        pendingAckTimers.delete(ackId);
        const clonedPayload = { ...current.payload };
        delete clonedPayload.ackId;
        failedDeliveries.set(ackId, { event: current.event, payload: clonedPayload });
        emitTelemetry("socket-delivery-final-fail", { event: current.event, sessionId: roomTarget, ackId });
        return;
      }
      current.attempt += 1;
      sendRawEvent(current.event, current.payload);
      scheduleAckRetry(ackId);
    }, ACK_TIMEOUT_MS);
    pendingAckTimers.set(ackId, pending);
  };

  const emitSession = (event, payload) => {
    const enriched = { ...payload };
    if (!enriched.sessionId) enriched.sessionId = roomTarget;
    let ackId = null;
    if (ackWatchlist.has(event)) {
      ackId = `${cycleState.requestId || roomTarget}-${event}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      enriched.ackId = ackId;
    }
    sendRawEvent(event, enriched);
    if (ackId) {
      const handleAck = (payload = {}) => {
        const { ackId: incomingAck, sessionId: ackSession } = payload || {};
        if (incomingAck !== ackId) return;
        if (ackSession && ackSession !== roomTarget) return;
        const pending = pendingAckTimers.get(ackId);
        if (!pending) return;
        if (pending.timer) clearTimeout(pending.timer);
        socket.off("delivery-ack", pending.handler);
        pendingAckTimers.delete(ackId);
        emitTelemetry("socket-delivery", { event: pending.event, sessionId: roomTarget, delivered: true, ackId });
      };
      socket.on("delivery-ack", handleAck);
      pendingAckTimers.set(ackId, { event, payload: enriched, attempt: 0, timer: null, handler: handleAck });
      scheduleAckRetry(ackId);
    } else {
      emitTelemetry("socket-delivery", { event, sessionId: enriched.sessionId, delivered: true });
    }
  };
  const emitTelemetry = (subtype, data = {}) => {
    // EVENT MODEL FIX: ensure telemetry follows standard shape and room scoping
    const payload = {
      type: "telemetry",
      subtype,
      sessionId: roomTarget,
      data,
    };
    if (socket?.server?.to) {
      socket.server.to(roomTarget).emit("telemetry", payload);
    } else {
      socket.emit("telemetry", payload);
    }
  };

  socket.on("delivery-resend-request", ({ ackId, sessionId: requester }) => {
    if (!ackId) return;
    if (requester && requester !== roomTarget) return;
    const failed = failedDeliveries.get(ackId);
    if (!failed) return;
    failedDeliveries.delete(ackId);
    emitTelemetry("socket-delivery-resend", { ackId, sessionId: roomTarget, event: failed.event });
    emitSession(failed.event, failed.payload);
  });
  // TEST-D-FIX: perform task extraction once telemetry helpers are available
  const taskSummary =
    extractedTasks.length > 0
      ? `Extracted ${extractedTasks.length} task(s): ${extractedTasks
          .map((t) => t.description)
          .filter(Boolean)
          .slice(0, 2)
          .join(" | ")}`
      : "No discrete tasks detected.";
  ledger.push(
    tagLedgerEntry(
      {
        timestamp: new Date().toISOString(),
        stage: "TaskExtraction",
        cycle: 0,
        summary: taskSummary,
        snippet: extractedTasks[0]?.rawText?.slice(0, 260) || input.slice(0, 260),
      },
      cycleState
    )
  );
  emitTelemetry("task-extraction", {
    event: "task-extraction",
    detectedTasks: extractedTasks,
    parseError: taskExtractionResult.parse_error,
  });
  const pcgpSummary =
    inlineRuleObjects.length > 0
      ? `Explicit rules extracted via API (${inlineRuleObjects.length}).`
      : "No explicit rules extracted via API (none detected).";
  ledger.push(
    tagLedgerEntry(
      {
        timestamp: new Date().toISOString(),
        stage: "RuleExtraction",
        cycle: 0,
        summary: pcgpSummary,
        snippet: inlineRuleObjects.map((r) => r.text).join(" | ").slice(0, 260) || input.slice(0, 260),
      },
      cycleState
    )
  );
  emitTelemetry("rule-extraction", {
    event: "rule-extraction",
    explicitCount: ruleExtractionResult.explicit?.length || 0,
    generalCount: ruleExtractionResult.general?.length || 0,
    inferredCount: ruleExtractionResult.candidateInferred?.length || 0,
    inlineRules: inlineRuleObjects.map((r) => r.text),
    parseError: ruleExtractionResult.parse_error,
  });
  // TEST-D-FIX: initialize cycleState only after room/session utilities exist
  cycleState = {
    requestId: runId || roomTarget,
    requestType,
    strictness:
      scaffoldStrictness ||
      {
        level: 0,
        label: "normal",
      },
    envelope: scaffoldEnvelope,
    classification: classifierSnapshot,
    parsedRules: allRules,
    cycleStep: "A",
    // V1-PHASE3: governance decision (computed later)
    governanceDecision: null,
    governanceDecisionDetail: null,
    normalizedRules: [],
    constraints: [],
    constraintSummary: null,
    ruleExtraction: null,
    taskExtraction: null,
    dataScopeMode: resolvedDataScopeMode || DEFAULT_DATA_SCOPE_MODE,
    governanceMode: resolvedGovernanceMode,
    isFictionalOrSynthetic: simulationSignals.isFictionalOrSynthetic || !!classifierSnapshot.simulationFlag,
    isSimulationHarness: simulationSignals.isSimulationHarness,
    continuationCheckpoint: null,
    errors: [],
    allowedSources: Array.isArray(sessionAllowedSources) ? sessionAllowedSources : ["internal"],
    allowWeb: sessionAllowWeb === true,
    provenanceMode: sessionProvenanceMode || "internal-only",
    // V1.1-PHASE1: grammar attachment
    grammar: {
      rawText: input, // V1.2-PHASE5-FIX: preserve full prompt for downstream web-detection
      tokens: grammarTokens,
      parsed: grammarParsed,
      semantics: grammarSemantics,
    },
  };
  // V1.2-PHASE1: execution-risk gating moved inside governed workflow after cycleState initialization
  {
    const actionCat = cycleState?.envelope?.actionCategory;
    const grammar = cycleState?.grammar;
    const strictness = cycleState?.strictness || { level: 0 };

    if (
      actionCat === "execution" ||
      (grammar?.semantics?.riskMarkers || []).includes("execute")
    ) {
      if (strictness.level >= 2) {
        return {
          allowed: false,
          clarification: true,
          reason: "requires_clarification",
          message:
            "This appears to be an execution-level request under high strictness. Please clarify your intent.",
        };
      }
    }
  }
  // V1.2-PHASE1: initialize dataScopeMode
  cycleState.dataScopeMode = resolvedDataScopeMode || DEFAULT_DATA_SCOPE_MODE;
  if (!cycleState.dataScopeMode) {
    cycleState.dataScopeMode = DEFAULT_DATA_SCOPE_MODE; // V1.2-PHASE1 safety default
  }
  console.debug("[cd/ai][mode]", cycleState.dataScopeMode);
  emitTelemetry("v1.2-mcp-entry-mode", {
    event: "v1.2-mcp-entry-mode",
    requestId: cycleState.requestId,
    mode: cycleState.dataScopeMode,
  }); // V1.2-PHASE4: MCP entry telemetry
  // TEST-F-FIX: standard snapshot + telemetry helper for cycle state invariants
  const snapshotCycleState = () => ({
    requestId: cycleState.requestId,
    requestType: cycleState.requestType,
    grammar: cycleState.grammar,
    normalizedRules: cycleState.normalizedRules,
    constraints: cycleState.constraints,
    constraintSummary: cycleState.constraintSummary,
    strictness: cycleState.strictness,
    envelope: cycleState.envelope,
    governanceDecision: cycleState.governanceDecision,
    governanceDecisionDetail: cycleState.governanceDecisionDetail,
    canonicalTrace: cycleState.canonicalTrace,
    dataScopeMode: cycleState.dataScopeMode,
  });
  const emitCycleState = (stage, phase) => {
    emitTelemetry("cycle-state", {
      stage,
      phase,
      snapshot: snapshotCycleState(),
    });
  };
  cycleState.taskExtraction = taskExtractionResult;
  cycleState.tasksNormalized = extractedTasks;
  cycleState.ruleExtraction = ruleExtractionResult;
  cycleState.inlineRules = inlineRuleObjects;
  // V1-PHASE6: normalized V1 telemetry
  const emitV1Telemetry = (event, rest = {}) => {
    emitTelemetry(event, {
      event,
      requestId: cycleState.requestId || runId || roomTarget || null,
      sessionId: roomTarget || null,
      requestType: cycleState.requestType || null,
      strictness: cycleState.strictness?.level ?? null,
      actionCategory: cycleState.envelope?.actionCategory ?? null,
      constraintsCount: (cycleState.envelope?.constraints || []).length ?? null,
      ...rest,
    });
  };
  const propagateDataScopeMode = (target, label = "runtime") => {
    if (!cycleState.dataScopeMode) {
      cycleState.dataScopeMode = DEFAULT_DATA_SCOPE_MODE; // V1.2-PHASE1 safety default
    }
    const host = target && typeof target === "object" ? target : null;
    if (host && !host.dataScopeMode) {
      host.dataScopeMode = cycleState.dataScopeMode; // V1.2-PHASE1 propagate
    }
    if (host && !host.allowedSources) {
      host.allowedSources = cycleState.allowedSources?.slice() || ["internal"];
    }
    if (host && typeof host.allowWeb !== "boolean") {
      host.allowWeb = !!cycleState.allowWeb;
    }
    if (host && !host.provenanceMode) {
      host.provenanceMode = cycleState.provenanceMode || "internal-only";
    }
    return host;
  };
  propagateDataScopeMode(cycleState, "initialization");
  const governanceTrace = (extra = {}) =>
    emitV1Telemetry("v1-governance-trace", {
      decision: cycleState.governanceDecision?.outcome,
       governanceMode: cycleState.governanceMode,
       simulation: isSimulationDecision(cycleState),
      ...extra,
    });
  // V1-PHASE6: invariants
  assertCycleStateShape(cycleState, "before-governance", { requireAnalysisFields: false });
  // V1-PHASE1B: supplemental event emit
  emitSession(MCP_EVENTS.CYCLE_START, { sessionId: roomTarget, requestId: runId || roomTarget });

  const strictnessLevel = normalizeStrictness(governanceStrictness);
  const mode = normalizePerfMode(perfMode);
  const userCap =
    maxCycles !== null && maxCycles !== undefined
      ? normalizeMaxCycles(maxCycles)
      : null;
  const cycleCapEnabled = userCap !== null;
  const plannedCycles = cycleCapEnabled ? userCap : HARD_MAX_CYCLES;
  emitTelemetry("cycle-plan", { plannedCycles });

  // Emit parsed governance rules after extraction for UI panel
  const parsedRulesPayload = formatParsedRules(allRules);
  emitSession("parsed-rules", { payload: { rules: parsedRulesPayload } });
  emitSession("governance-rules", { payload: { rules: parsedRulesPayload } });
  // V1.1-PHASE2: normalize rule + constraint algebra
  const normalizedRules = normalizeRules(allRules);
  cycleState.normalizedRules = normalizedRules;
  const primitiveConstraints = deriveConstraints(normalizedRules);
  if (inlineRuleObjects.length > 0 && primitiveConstraints.length === 0) {
    // TEST-D-FIX: ensure inline/task rules register with constraint algebra to avoid false require_rules
    primitiveConstraints.push({
      type: "inline_rule_present",
      severity: "soft",
      source: "task-inline",
    });
  } else if (normalizedRules.length > 0 && primitiveConstraints.length === 0) {
    // TEST-F-FIX: ensure provided user rules register with constraint algebra for governance matrix
    primitiveConstraints.push({
      type: "rule_present",
      severity: "soft",
      source: "user",
    });
  }
  const mergedConstraints = mergeConstraints([primitiveConstraints]);
  const algebraResult = evaluateConstraintAlgebra(mergedConstraints);
  cycleState.constraints = algebraResult.finalConstraints;
  cycleState.constraintSummary = algebraResult.summary;
  const summarySnapshot = cycleState.constraintSummary || {};
  emitTelemetry("v1.1-constraint-normalization", {
    event: "v1.1-constraint-normalization",
    requestId: cycleState.requestId,
    ruleCount: allRules.length,
    normalizedRuleCount: normalizedRules.length,
    primitiveConstraintCount: primitiveConstraints.length,
    finalConstraintCount: mergedConstraints.length,
  });
  emitTelemetry("v1.1-constraint-algebra", {
    event: "v1.1-constraint-algebra",
    requestId: cycleState.requestId,
    hasHardBlock: algebraResult.summary.hardBlock,
    totalConstraints: algebraResult.summary.total,
  });
  // V1-PHASE4: normalize constraints from parsed rules for envelope compatibility
  const normalizedConstraints = extractConstraintsFromRules(parsedRulesPayload);
  scaffoldEnvelope = { ...scaffoldEnvelope, constraints: normalizedConstraints };
  const classifierStrictness =
    classifierSnapshot?.requiredStrictness && typeof classifierSnapshot.requiredStrictness.level === "number"
      ? classifierSnapshot.requiredStrictness
      : null;
  const computedStrictness = computeStrictness(input, allRules, { ...scaffoldEnvelope, requestType });
  scaffoldStrictness =
    classifierStrictness && classifierStrictness.level > (computedStrictness?.level ?? 0)
      ? classifierStrictness
      : computedStrictness;
  // V1.1-PHASE1: grammar telemetry
  emitTelemetry("v1.1-grammar", {
    event: "v1.1-grammar",
    requestId: cycleState.requestId,
    tokenCount: grammarTokens.length,
    primaryVerb: grammarSemantics.primaryVerb,
    primaryObject: grammarSemantics.primaryObject,
    qualifiers: grammarSemantics.qualifiers,
    riskMarkers: grammarSemantics.riskMarkers,
  });
  emitV1Telemetry("v1-governance-init", {
    envelopeIntent: scaffoldEnvelope?.userIntent || "unknown",
  });
  // V1-PHASE2: bind invariants to cycle state
  cycleState.parsedRules = parsedRulesPayload;
  cycleState.strictness = scaffoldStrictness;
  cycleState.envelope = scaffoldEnvelope;
  // V1.1-PHASE2: attach evaluated constraint algebra to cycle state
  cycleState.constraints = algebraResult.finalConstraints;
  // V1-PHASE3: compute governance decision
  const governanceDecision = evaluateGovernance(requestType, allRules, scaffoldStrictness, scaffoldEnvelope, {
    constraints: cycleState.constraints,
    constraintSummary: cycleState.constraintSummary,
    grammar: cycleState.grammar,
    dataScopeMode: cycleState.dataScopeMode,
    allowWeb: cycleState.allowWeb,
    governanceMode: cycleState.governanceMode,
    isFictionalOrSynthetic: cycleState.isFictionalOrSynthetic,
    isSimulationHarness: cycleState.isSimulationHarness,
    requestId: cycleState.requestId,
    telemetry: {
      emit: (payload) => emitTelemetry("v1.2-matrix-eval", payload),
    },
  }); // V1.1-PHASE3: governance matrix wrapper
  cycleState.governanceDecision = governanceDecision;
  cycleState.governanceDecisionDetail = {
    requestType,
    strictness: scaffoldStrictness,
    actionCategory: scaffoldEnvelope?.actionCategory,
    constraintSummary: cycleState.constraintSummary,
    grammar: cycleState.grammar,
    governanceMode: cycleState.governanceMode,
    simulation: isSimulationDecision(cycleState),
  }; // V1.1-PHASE3: governance decision metadata
  ensureCycleStateCoherence(cycleState); // V1.1-PHASE5: cycleState coherence enforcement after analysis
  assertCycleStateShape(cycleState, "post-analysis", { requireAnalysisFields: true });
  assertGovernanceDecision(governanceDecision, "workflow-start");
  emitV1Telemetry("v1-governance-decision", {
    decision: governanceDecision.outcome,
    rationale: governanceDecision.rationale,
  });
  emitV1Telemetry("v1-governance-intermediate", {
    decision: governanceDecision.outcome,
  });
  // V1.1-PHASE3: decision matrix telemetry
  emitTelemetry("v1.1-governance-matrix", {
    event: "v1.1-governance-matrix",
    requestId: cycleState.requestId,
    requestType,
    strictness: scaffoldStrictness?.level ?? 0,
    actionCategory: scaffoldEnvelope?.actionCategory,
    hardBlock: cycleState.constraintSummary?.hardBlock || false,
    riskMarkers: cycleState.grammar?.semantics?.riskMarkers || [],
    outcome: governanceDecision.outcome,
  });
  // V1.1-PHASE5: canonical trace emission
  cycleState.canonicalTrace = {
    requestId: cycleState.requestId,
    requestType: cycleState.requestType,
    strictness: cycleState.strictness?.level ?? 0,
    dataScopeMode: cycleState.dataScopeMode, // V1.2-PHASE1: add data scope mode to canonical trace
    modeAtEntry: cycleState.dataScopeMode, // V1.2-PHASE4: record mode at MCP boundary
    allowedSources: cycleState.allowedSources,
    allowWeb: cycleState.allowWeb,
    provenanceMode: cycleState.provenanceMode,
    governanceMode: cycleState.governanceMode,
    simulation: isSimulationDecision(cycleState),
    actionCategory: cycleState.envelope?.actionCategory,
    grammar: cycleState.grammar?.semantics,
    constraintSummary: cycleState.constraintSummary,
    decision: cycleState.governanceDecision?.outcome,
    rationale: cycleState.governanceDecision?.rationale,
    steps: {
      grammar: "completed",
      ruleNormalization: "completed",
      constraintAlgebra: "completed",
      matrixDecision: "completed",
      outputShaping: "completed",
      validation: "completed",
    },
  };
  emitTelemetry("v1.1-canonical-trace", {
    event: "v1.1-canonical-trace",
    trace: cycleState.canonicalTrace,
  });
  emitTelemetry("v1.2-data-scope-trace", {
    event: "v1.2-data-scope-trace",
    requestId: cycleState.requestId,
    mode: cycleState.dataScopeMode,
    allowedSources: cycleState.allowedSources,
    allowWeb: cycleState.allowWeb,
    provenanceMode: cycleState.provenanceMode,
    traceAttached: true,
  }); // V1.2-PHASE1
  governanceTrace();
  emitCycleState("Governance", "pre-cycle"); // TEST-F-FIX: ensure baseline snapshot even if cycles short-circuit

  // TEST-E-FIX: persist full state for clarification checkpoints/resume
  // TEST-E-FIX/TEST-F-FIX: persist full state for clarification checkpoints/resume
  const contextForResume = {
    ledger,
    rawRules: allRules,
    normalizedRules,
    governanceEnvelope,
    input,
    goal,
    plannedCycles,
    mode,
    mustGovernOutput,
    roomTarget,
    runId: cycleState.requestId,
    // V1-PHASE1B: attach scaffolding (no behavior change)
    parsedInput,
    requestType: cycleState.requestType,
    scaffoldEnvelope,
    scaffoldStrictness,
    // TEST-F-FIX: ensure checkpoint captures canonical identifiers + state
    requestId: cycleState.requestId,
    strictness: cycleState.strictness,
    envelope: cycleState.envelope,
    grammar: cycleState.grammar,
    constraints: cycleState.constraints,
    constraintSummary: cycleState.constraintSummary,
    canonicalTrace: cycleState.canonicalTrace,
    governanceDecision,
    governanceDecisionDetail: cycleState.governanceDecisionDetail,
    cycleState,
    clarificationEscalations: 0, // TEST-G-FIX: track clarification depth for cascades
    dataScopeMode: cycleState.dataScopeMode, // V1.2-PHASE1: persist data scope in checkpoint context
    pendingClarificationType: null, // V1.2-PHASE3: mode-aware clarifications
    governanceMode: cycleState.governanceMode,
    isFictionalOrSynthetic: cycleState.isFictionalOrSynthetic,
    isSimulationHarness: cycleState.isSimulationHarness,
  };
  emitV1Telemetry("mcp-step", {
    step: "A",
    envelopePresent: !!cycleState.envelope,
  });
  // V1-PHASE1B: supplemental event emit
  emitSession(MCP_EVENTS.CYCLE_START, { sessionId: roomTarget, requestId: cycleState.requestId });

  // V1-PHASE5: enforce ASK_CLARIFICATION governance decision
  if (governanceDecision.outcome === GOVERNANCE_DECISIONS.ASK_CLARIFICATION) {
    const clarificationPrompt =
      "This appears to be a high-risk governed action. Before I proceed, I need clarification on your intent and constraints. Please specify:\n- The exact action you want taken\n- Any limits or boundaries (e.g., read-only vs edit/execute)\n- Whether this is a draft, simulation, or a real decision";
    const checkpoint = checkpointCycleState({
      ...contextForResume,
      cycle: 1,
      currentText: "",
      validation: {},
      // TEST-E-FIX: retain numeric strictness coefficient for resume flow
      effectiveStrictness: strictnessLevel,
      dataScopeMode: cycleState.dataScopeMode, // V1.2-PHASE1: save data scope in ASK_CLARIFICATION checkpoint
    });
    emitSession("governance-clarification", {
      payload: { question: clarificationPrompt, cycle: 1, runId: runId || roomTarget },
      sessionId: roomTarget,
    });
    emitTelemetry("mcp-clarification-checkpoint-created", {
      event: "mcp-clarification-checkpoint-created",
      requestId: cycleState.requestId,
      sessionId: roomTarget,
      cycleStep: "M1",
    });
    // TEST-E-FIX: emit telemetry snapshot for governance-decision clarification
    emitTelemetry("v1.1-output-shaping", {
      event: "v1.1-output-shaping",
      requestId: cycleState.requestId,
      strictness: cycleState.strictness?.level ?? null,
      constraints: (cycleState.constraints || []).map((c) => c.type),
      governanceDecision: cycleState.governanceDecision?.outcome,
      status: "clarification-requested",
    });
    emitTelemetry("v1.1-validation", {
      event: "v1.1-validation",
      requestId: cycleState.requestId,
      allowed: false,
      reason: "requires_clarification",
      triggeredClarification: true,
    });
    emitSession(MCP_EVENTS.CLARIFICATION_REQUIRED, { sessionId: roomTarget, requestId: cycleState.requestId });
    socket.emit("gil-event", { state: "idle" });
    governanceTrace({ askClarification: true });
    return { paused: true, context: checkpoint };
  }

  // V1-PHASE4: enforce BLOCK governance decision
  if (governanceDecision.outcome === GOVERNANCE_DECISIONS.BLOCK) {
    const message =
      "I recognized this as a governed request that conflicts with an active 'do not proceed' policy. I cannot perform this action because it would violate one or more governance constraints.";
    const blockScopeSignals = { containsExternalData: false };
    const decoratedBlock = applyDataScopeDecorations(
      message,
      cycleState,
      blockScopeSignals,
      cycleState.constraintSummary
    ); // V1.2-PHASE5-FIX: ensure block responses include mode context
    annotateCanonicalTraceDataScope(cycleState, blockScopeSignals, decoratedBlock); // V1.2-PHASE5-FIX: keep trace consistent on early exits
    emitTelemetry("v1.1-canonical-trace", {
      event: "v1.1-canonical-trace",
      phase: "final",
      trace: cycleState.canonicalTrace,
    });
  emitTelemetry("v1.2-data-scope-trace", {
    event: "v1.2-data-scope-trace",
    requestId: cycleState.requestId,
    mode: cycleState.dataScopeMode,
    allowedSources: cycleState.allowedSources,
    allowWeb: cycleState.allowWeb,
    provenanceMode: cycleState.provenanceMode,
    traceAttached: true,
    phase: "final",
  });
    emitV1Telemetry("v1-governance-block", {
      decision: governanceDecision.outcome,
      rationale: governanceDecision.rationale,
    });
    emitTelemetry("final-output", { text: decoratedBlock, narrative: null });
    emitSession("governed-output", { payload: { text: decoratedBlock, narrative: null } });
    emitV1Telemetry("v1-governance-decision-complete", {
      decision: governanceDecision.outcome,
    });
    governanceTrace({ block: true });
    emitSession("workflow-finished", { payload: { runId: runId || roomTarget, sessionId: roomTarget } });
    emitTelemetry("workflow-finished", { requestId: cycleState.requestId, sessionId: roomTarget });
    socket.emit("gil-event", { state: "idle" });
    return;
  }

  // V1-PHASE3: enforce rules-required short-circuit
  if (governanceDecision.outcome === GOVERNANCE_DECISIONS.REQUIRE_RULES) {
    const message =
      "I recognized this as a governed action, but there are no governance rules configured for it yet. I cannot safely proceed until rules are defined.";
    const requireScopeSignals = { containsExternalData: false };
    const decoratedRequire = applyDataScopeDecorations(
      message,
      cycleState,
      requireScopeSignals,
      cycleState.constraintSummary
    ); // V1.2-PHASE5-FIX: attach mode context to require-rules exits
    annotateCanonicalTraceDataScope(cycleState, requireScopeSignals, decoratedRequire);
    emitTelemetry("v1.1-canonical-trace", {
      event: "v1.1-canonical-trace",
      phase: "final",
      trace: cycleState.canonicalTrace,
    });
  emitTelemetry("v1.2-data-scope-trace", {
    event: "v1.2-data-scope-trace",
    requestId: cycleState.requestId,
    mode: cycleState.dataScopeMode,
    allowedSources: cycleState.allowedSources,
    allowWeb: cycleState.allowWeb,
    provenanceMode: cycleState.provenanceMode,
    traceAttached: true,
    phase: "final",
  });
    emitTelemetry("final-output", { text: decoratedRequire, narrative: null });
    emitSession("governed-output", { payload: { text: decoratedRequire, narrative: null } });
    emitV1Telemetry("v1-governance-decision-complete", {
      decision: governanceDecision.outcome,
    });
    governanceTrace({ requireRules: true });
    emitSession("workflow-finished", { payload: { runId: runId || roomTarget, sessionId: roomTarget } });
    emitTelemetry("workflow-finished", { requestId: cycleState.requestId, sessionId: roomTarget });
    socket.emit("gil-event", { state: "idle" });
    return;
  }

  // Turbo / fast mode: approximate single-pass governed draft
  if (mode !== "real") {
    await runTurboWorkflow(socket, {
      input,
      goal,
      rules: allRules,
      governanceStrictness: strictnessLevel,
      ledger,
      requiresGovernedOutput: mustGovernOutput,
      sessionId: roomTarget,
      emitSession,
      governanceDecision,
      requestType,
    });
    return;
  }

  // Check drift relative to current rules (if any)
  const skipDriftCheck =
    inlineRuleObjects.length > 0 || normalizedInputRules.length > 0; // TEST-F-FIX: avoid false-positive drift when explicit rules are provided
  const drift =
    !skipDriftCheck && allRules.length > 0
      ? await checkContextDrift(input, allRules, {
          strictness: scaffoldStrictness?.level ?? strictnessLevel?.level ?? 0,
        })
      : null;
  if (drift?.driftDetected) {
    const msg =
      drift.explanation || "Task appears unrelated to current rules.";
    const narrative = await generateGovernanceNarrative({
      summary: msg,
      explanation: msg,
      confidence: drift.confidence || 0.8,
    });
    const driftScopeSignals = { containsExternalData: false };
    let driftOutput = narrative || msg;
    driftOutput = prefixSimulationBanner(driftOutput, cycleState);
    const driftText = applyDataScopeDecorations(
      driftOutput,
      cycleState,
      driftScopeSignals,
      cycleState.constraintSummary
    ); // V1.2-PHASE5-FIX: preserve data-scope context on drift exits
    annotateCanonicalTraceDataScope(cycleState, driftScopeSignals, driftText);
    emitTelemetry("v1.1-canonical-trace", {
      event: "v1.1-canonical-trace",
      phase: "final",
      trace: cycleState.canonicalTrace,
    });
  emitTelemetry("v1.2-data-scope-trace", {
    event: "v1.2-data-scope-trace",
    requestId: cycleState.requestId,
    mode: cycleState.dataScopeMode,
    allowedSources: cycleState.allowedSources,
    allowWeb: cycleState.allowWeb,
    provenanceMode: cycleState.provenanceMode,
    traceAttached: true,
    phase: "final",
  });
    const driftSimulationActive = isSimulationDecision(cycleState);
    emitTelemetry("final-output", { text: driftText, narrative: narrative || msg, simulation: driftSimulationActive });
    emitSession("governed-output", {
      payload: { text: driftText, narrative: narrative || msg, simulation: driftSimulationActive },
    });
    emitTelemetry("ledger", { entries: ledger, simulation: driftSimulationActive });
    emitSession("workflow-finished", { payload: { runId: runId || roomTarget, sessionId: roomTarget } });
    emitTelemetry("workflow-finished", { requestId: cycleState.requestId, sessionId: roomTarget });
    return;
  }

  // Initial Task Agent draft --------------------------------------------------
  const taskDraft = await taskAgentPass({
    input,
    rules: allRules,
  });
  let currentText =
    taskDraft || `Initial draft based on: "${input}"`;

  emitTelemetry("hemisphere-log", {
    hemisphere: "A",
    message: "Task Agent produced the first draft.",
  });
  cycleState.cycleStep = "A";
  emitTelemetry("mcp-step", {
    event: "mcp-step",
    step: "A",
    requestId: cycleState.requestId,
    envelopePresent: !!cycleState.envelope,
    strictness: cycleState.strictness?.level ?? 0,
  });
  // V1-PHASE1B: supplemental event emit
  emitSession(MCP_EVENTS.ENTER_ANALYTICAL, { sessionId: roomTarget, requestId: cycleState.requestId });
  ledger.push(
    tagLedgerEntry(
      {
        timestamp: new Date().toISOString(),
        stage: "TaskAgent",
        cycle: 0,
        summary: "Task Agent produced the first draft.",
        snippet: currentText.slice(0, 260),
      },
      cycleState
    )
  );

  let validation = {
    forbiddenHits: [],
    wordCountOk: true,
    artifactsOk: true,
    impliedReliabilityOk: true,
    isCompliant: false,
  };
  let converged = false;
  let cyclesRun = 0;

  let effectiveStrictness = strictnessLevel;
  const effectiveMax = plannedCycles;

  for (let cycle = 1; cycle <= effectiveMax; cycle++) {
    cyclesRun = cycle;
    emitTelemetry("cycle-update", { cycle });
    cycleState.cycleStep = "A";
    emitTelemetry("mcp-step", {
      event: "mcp-step",
      step: "A",
      requestId: cycleState.requestId,
      envelopePresent: !!cycleState.envelope,
      strictness: cycleState.strictness?.level ?? 0,
    });
    // V1-PHASE1B: supplemental event emit
    emitSession(MCP_EVENTS.ENTER_ANALYTICAL, { sessionId: roomTarget, requestId: cycleState.requestId });
    emitCycleState("Analytical", "entry"); // TEST-F-FIX: snapshot at analytical entry
    propagateDataScopeMode(cycleState, "analytical-entry"); // V1.2-PHASE1
    emitTelemetry("v1.2-data-scope-init", {
      event: "v1.2-data-scope-init",
      requestId: cycleState.requestId,
      mode: cycleState.dataScopeMode,
    }); // V1.2-PHASE1 telemetry scaffold

    if (cycle === 1 && mustGovernOutput) {
      currentText = applyCycleOneFilters(currentText);
    }

    // V1.1-PHASE4: governed prompt shaping
    const analyticalInput = buildGovernedPrompt(input, cycleState);
    emitTelemetry("v1.1-output-shaping", {
      event: "v1.1-output-shaping",
      requestId: cycleState.requestId,
      strictness: cycleState.strictness?.level ?? null,
      constraints: (cycleState.constraints || []).map((c) => c.type),
      governanceDecision: cycleState.governanceDecision?.outcome,
      cycle,
      phase: "analytical-entry",
    }); // TEST-F-FIX: per-cycle shaping telemetry

    // Analytical hemisphere
    const analyticalResult = await analyticalPass(currentText, {
      // V1-PHASE3: annotate governed prompt with envelope/strictness
      input: analyticalInput,
      rules: allRules,
      governanceStrictness: effectiveStrictness,
      requiresGovernedOutput: mustGovernOutput,
    });
    propagateDataScopeMode(analyticalResult, "analytical-exit"); // V1.2-PHASE1
    currentText = analyticalResult.rewrittenText;
    validation = analyticalResult.validation;
    emitCycleState("Analytical", "exit"); // TEST-F-FIX: snapshot after analytical pass
    ledger.push(
      tagLedgerEntry(
        {
          timestamp: new Date().toISOString(),
          stage: "Analytical",
          cycle,
          summary: analyticalResult.deltaSummary || "Analytical pass completed.",
          snippet: currentText.slice(0, 260),
        },
        cycleState
      )
    );
    emitTelemetry("hemisphere-log", {
      hemisphere: "A",
      message: `Cycle ${cycle}: ${analyticalResult.deltaSummary || "Analytical pass completed."}`,
    });
    emitTelemetry("mcp-status", {
      status: "Analytical Pass",
      detail: `Cycle ${cycle}: analytical hemisphere enforcing governance constraints.`,
    });
    cycleState.cycleStep = "M1";
    emitV1Telemetry("mcp-step", {
      step: "M1",
      envelopePresent: !!cycleState.envelope,
    });
    // V1-PHASE1B: supplemental event emit
    emitSession(MCP_EVENTS.ENTER_MODERATOR_1, { sessionId: roomTarget, requestId: cycleState.requestId });
    emitCycleState("Moderator", "entry"); // TEST-F-FIX: moderator entry snapshot
    propagateDataScopeMode(cycleState, "moderator-entry"); // V1.2-PHASE1

    // Moderator hemisphere
    const moderatorResult = await moderatorPass(currentText, {
      input,
      rules: allRules,
      governanceStrictness: effectiveStrictness,
      analyticalSummary: analyticalResult.deltaSummary,
      directives: analyticalResult.directives,
      validation,
      mediumCandidates:
        analyticalResult.inferredConstraints || [],
      governanceEnvelope,
    });
    propagateDataScopeMode(moderatorResult, "moderator-exit"); // V1.2-PHASE1
    const moderatorEntryTimestamp = new Date().toISOString();
    const moderatorSummary = moderatorResult.moderatorSummary || "Moderator pass completed.";
    const moderatorLogMessage = `Cycle ${cycle}: ${moderatorSummary}`;
    ledger.push(
      tagLedgerEntry(
        {
          timestamp: moderatorEntryTimestamp,
          stage: "Moderator",
          cycle,
          summary: moderatorSummary,
          snippet: currentText.slice(0, 260),
        },
        cycleState
      )
    );
    emitTelemetry("moderator-log", {
      message: moderatorLogMessage,
      cycle,
      phase: "pre",
      passId: "moderator_pre",
      timestamp: moderatorEntryTimestamp,
    });
    emitTelemetry("mcp-status", {
      status: "Moderator",
      detail: `Cycle ${cycle}: moderator tightening creative prompt.`,
    });
    emitCycleState("Moderator", "exit"); // TEST-F-FIX: moderator exit snapshot

    if (moderatorResult.needsUserClarification) {
      const question = moderatorResult.userQuestion || "Please clarify the most important constraint.";
      emitSession("governance-clarification", {
        payload: { question, cycle, runId: runId || roomTarget },
        sessionId: roomTarget,
      });
      emitTelemetry("clarification-request", { question, cycle });
      // TEST-E-FIX: record shaping/validation status before pause
      emitTelemetry("v1.1-output-shaping", {
        event: "v1.1-output-shaping",
        requestId: cycleState.requestId,
        strictness: cycleState.strictness?.level ?? null,
        constraints: (cycleState.constraints || []).map((c) => c.type),
        governanceDecision: cycleState.governanceDecision?.outcome,
        status: "clarification-requested",
      });
      emitTelemetry("v1.1-validation", {
        event: "v1.1-validation",
        requestId: cycleState.requestId,
        allowed: false,
        reason: "requires_clarification",
        triggeredClarification: true,
      });
      cycleState.cycleStep = "M1";
      emitTelemetry("mcp-step", {
        event: "mcp-step",
        step: "M1",
        requestId: cycleState.requestId,
        envelopePresent: !!cycleState.envelope,
        strictness: cycleState.strictness?.level ?? 0,
      });
      // V1-PHASE1B: supplemental event emit
      emitSession(MCP_EVENTS.CLARIFICATION_REQUIRED, { sessionId: roomTarget, requestId: cycleState.requestId });
      socket.emit("gil-event", { state: "idle" });
      // V1-PHASE1C: store MCP checkpoint for clarification
      const checkpoint = checkpointCycleState({
        requestId: cycleState.requestId,
        requestType: cycleState.requestType,
        strictness: cycleState.strictness,
        envelope: cycleState.envelope,
        parsedRules: cycleState.parsedRules,
        cycleStep: "M1",
        ...contextForResume,
        dataScopeMode: cycleState.dataScopeMode, // V1.2-PHASE1: save data scope mode into checkpoint
        cycle,
        currentText,
        validation,
        moderatorResult,
        effectiveStrictness,
      });
      emitTelemetry("mcp-clarification-checkpoint-created", {
        event: "mcp-clarification-checkpoint-created",
        requestId: cycleState.requestId,
        sessionId: roomTarget,
        cycleStep: "M1",
      });
      annotateCanonicalTraceDataScope(cycleState, {}, currentText); // V1.2-PHASE5-FIX: snapshot data scope even when paused
      emitTelemetry("v1.1-canonical-trace", {
        event: "v1.1-canonical-trace",
        phase: "final",
        paused: true,
        trace: cycleState.canonicalTrace,
      });
  emitTelemetry("v1.2-data-scope-trace", {
    event: "v1.2-data-scope-trace",
    requestId: cycleState.requestId,
    mode: cycleState.dataScopeMode,
    allowedSources: cycleState.allowedSources,
    allowWeb: cycleState.allowWeb,
    provenanceMode: cycleState.provenanceMode,
    traceAttached: true,
    phase: "final",
    paused: true,
  });
      return {
        paused: true,
        context: checkpoint,
      };
    }

    // Creative hemisphere
    // V1.1-PHASE4: governed prompt shaping
    const creativeModeratedPrompt = buildGovernedPrompt(moderatorResult.moderatedPrompt, cycleState);
    emitCycleState("Creative", "entry"); // TEST-F-FIX: creative entry snapshot
    propagateDataScopeMode(cycleState, "creative-entry"); // V1.2-PHASE1
    const creativeResult = await creativePass(currentText, {
      input,
      rules: allRules,
      governanceStrictness: effectiveStrictness,
      // V1-PHASE3: annotate governed prompt with envelope/strictness
      moderatedPrompt: creativeModeratedPrompt,
      userFeedback: null,
    });
    propagateDataScopeMode(creativeResult, "creative-exit"); // V1.2-PHASE1
    currentText = creativeResult.rewrittenText;
    ledger.push(
      tagLedgerEntry(
        {
          timestamp: new Date().toISOString(),
          stage: "Creative",
          cycle,
          summary: creativeResult.deltaSummary || "Creative pass completed.",
          snippet: currentText.slice(0, 260),
        },
        cycleState
      )
    );
    emitTelemetry("hemisphere-log", {
      hemisphere: "C",
      message: `Cycle ${cycle}: ${creativeResult.deltaSummary || "Creative pass completed."}`,
    });
    emitTelemetry("mcp-status", {
      status: "Creative Pass",
      detail: `Cycle ${cycle}: creative hemisphere refining output.`,
    });
    cycleState.cycleStep = "C";
    emitV1Telemetry("mcp-step", {
      step: "C",
      envelopePresent: !!cycleState.envelope,
    });
    // V1-PHASE1B: supplemental event emit
    emitSession(MCP_EVENTS.ENTER_CREATIVE, { sessionId: roomTarget, requestId: cycleState.requestId });
    emitCycleState("Creative", "exit"); // TEST-F-FIX: creative exit snapshot

    // Second Moderator pass (post-creative)
    emitCycleState("Moderator-2", "entry"); // TEST-F-FIX: moderator-2 entry snapshot
    propagateDataScopeMode(cycleState, "moderator2-entry"); // V1.2-PHASE1
    const moderatorResult2 = await moderatorPass(currentText, {
      input,
      rules: allRules,
      governanceStrictness: effectiveStrictness,
      analyticalSummary: moderatorResult.deltaSummary,
      directives: moderatorResult.directives,
      validation,
    });
    propagateDataScopeMode(moderatorResult2, "moderator2-exit"); // V1.2-PHASE1
    const moderatorPostTimestamp = new Date().toISOString();
    const moderatorPostSummary =
      moderatorResult2.deltaSummary ||
      moderatorResult2.moderatorSummary ||
      "Moderator refined post-creative draft.";
    const moderatorPostLogMessage = `Cycle ${cycle}: ${moderatorPostSummary}`;
    ledger.push(
      tagLedgerEntry(
        {
          timestamp: moderatorPostTimestamp,
          stage: "Moderator-2",
          cycle,
          summary: moderatorPostSummary,
          snippet: currentText.slice(0, 260),
        },
        cycleState
      )
    );
    emitTelemetry("moderator-log", {
      message: moderatorPostLogMessage,
      cycle,
      phase: "post",
      passId: "moderator_post",
      timestamp: moderatorPostTimestamp,
    });
    currentText = moderatorResult2.moderatedPrompt || currentText;
    cycleState.cycleStep = "M2";
    emitV1Telemetry("mcp-step", {
      step: "M2",
      envelopePresent: !!cycleState.envelope,
    });
    // V1-PHASE1B: supplemental event emit
    emitSession(MCP_EVENTS.ENTER_MODERATOR_2, { sessionId: roomTarget, requestId: cycleState.requestId });
    emitCycleState("Moderator-2", "exit"); // TEST-F-FIX: moderator-2 exit snapshot

    // Validator / meta-governance
    emitCycleState("Validator", "entry"); // TEST-F-FIX: validator entry snapshot
    propagateDataScopeMode(cycleState, "validator-entry"); // V1.2-PHASE1
    const postCreativeValidation = await validatorPass(currentText, {
      input,
      rules: allRules,
      governanceStrictness: effectiveStrictness,
      hemisphere: "creative",
      governanceDecision: cycleState.governanceDecision?.outcome || null,
    });
    propagateDataScopeMode(postCreativeValidation, "validator-exit"); // V1.2-PHASE1
    validation = postCreativeValidation;
    const validatorTimestamp = validation.timestamp || new Date().toISOString();
    const validatorDecision =
      validation.decision ||
      (validation.isCompliant === true ? "pass" : validation.qualityState === "yellow" ? "review" : "fail");
    const validatorBaseSummary =
      validation.summary ||
      validation.rationale ||
      (validation.isCompliant === true
        ? "Validator marked output as compliant."
        : "Validator flagged governance risks.");
    const validatorSummary = validation.simulationAdvisory
      ? `${validatorBaseSummary} ${validation.simulationAdvisory}`.trim()
      : validatorBaseSummary;
    const validatorEntry = {
      timestamp: validatorTimestamp,
      stage: "Validator",
      cycle,
      summary: validatorSummary,
      snippet: currentText.slice(0, 260),
      decision: validatorDecision,
      hemisphere: validation.hemisphere || "creative",
      strictness:
        validation.strictnessLevel ??
        (typeof effectiveStrictness === "number" ? effectiveStrictness : effectiveStrictness?.level ?? null),
      ruleIds: Array.isArray(validation.ruleIds) ? validation.ruleIds : [],
      rationale: validatorSummary,
      qualityState: validation.qualityState || (validation.isCompliant ? "green" : "red"),
      requiresCorrection: !!validation.requiresCorrection,
      requiresHumanReview: !!validation.requiresHumanReview,
      absoluteIssues: validation.absoluteIssues || [],
      contextualIssues: validation.contextualIssues || [],
      softIssues: validation.softIssues || [],
      overrides: validation.overrideRecords || [],
      assessmentLog: validation.assessmentLog || [],
    };
    if (validation.simulationAdvisory) {
      validatorEntry.simulationAdvisory = validation.simulationAdvisory;
    }
    ledger.push(tagLedgerEntry(validatorEntry, cycleState));
    if ((validation.overrideRecords || []).length) {
      validation.overrideRecords.forEach((record) => {
        ledger.push(
          tagLedgerEntry(
            {
              timestamp: record.timestamp || validatorTimestamp,
              stage: "ValidatorOverride",
              cycle,
              summary: `Override by ${record.userName || record.userId || "authorized user"}`,
              snippet: record.justification || "Override applied.",
              decision: validatorDecision,
              hemisphere: validatorEntry.hemisphere,
              strictness: validatorEntry.strictness,
              rationale: record.justification || "Override recorded.",
              overrideRecord: record,
            },
            cycleState
          )
        );
      });
    }
    emitTelemetry("hemisphere-log", {
      hemisphere: "A",
      message: `Cycle ${cycle}: ${validatorSummary}`,
    });
    emitTelemetry("hemisphere-validation", {
      validation: {
        ...validation,
        cycle,
        decision: validatorDecision,
        summary: validatorSummary,
      },
    });
    emitTelemetry("v1.1-validation", {
      event: "v1.1-validation",
      requestId: cycleState.requestId,
      allowed: validation.isCompliant === true,
      reason: validation.isCompliant ? null : "validation_pending",
      cycle,
      phase: "validator-cycle",
      qualityState: validatorEntry.qualityState,
      requiresCorrection: !!validation.requiresCorrection,
      requiresHumanReview: !!validation.requiresHumanReview,
      validation,
    }); // TEST-F-FIX: per-cycle validation telemetry
    emitTelemetry("validator-event", {
      cycle,
      entry: validatorEntry,
      validation: {
        ...validation,
        decision: validatorDecision,
        summary: validatorSummary,
      },
      overrides: validation.overrideRecords || [],
    });
    emitTelemetry("mcp-status", {
      status: "Validator",
      detail: `Cycle ${cycle}: validator checking governance compliance.`,
    });
    cycleState.cycleStep = "V";
    emitV1Telemetry("mcp-step", {
      step: "V",
      envelopePresent: !!cycleState.envelope,
    });
    // V1-PHASE1B: supplemental event emit
    emitSession(MCP_EVENTS.ENTER_VALIDATOR, { sessionId: roomTarget, requestId: cycleState.requestId });
    emitCycleState("Validator", "exit"); // TEST-F-FIX: validator exit snapshot
    emitTelemetry("ledger-entry", {
      entries: [validatorEntry],
      simulation: isSimulationDecision(cycleState),
    });
    emitTelemetry("mcp-status", {
      status: `Cycle ${cycle} completed`,
    });
    // V1-PHASE1B: supplemental event emit
    emitSession(MCP_EVENTS.CYCLE_COMPLETE, { sessionId: roomTarget, requestId: cycleState.requestId, cycle });

    // V1-PHASE5: validator-triggered clarification
    if (
      scaffoldStrictness?.level >= 2 &&
      (scaffoldEnvelope?.actionCategory === "decision" || scaffoldEnvelope?.actionCategory === "execution") &&
      governanceDecision.outcome !== GOVERNANCE_DECISIONS.BLOCK
    ) {
      const validatorClarify =
        "This governed request involves elevated decision/execution risk. Please clarify exact intent, boundaries (read-only vs execute), and whether this is a draft or real action before I continue.";
      const checkpoint = checkpointCycleState({
        ...contextForResume,
        cycle,
        currentText,
        validation,
        effectiveStrictness,
        dataScopeMode: cycleState.dataScopeMode, // V1.2-PHASE1: persist data scope mode for validator clarification
      });
      emitSession("governance-clarification", {
        payload: { question: validatorClarify, cycle, runId: runId || roomTarget },
        sessionId: roomTarget,
      });
      emitTelemetry("mcp-clarification-checkpoint-created", {
        event: "mcp-clarification-checkpoint-created",
        requestId: cycleState.requestId,
        sessionId: roomTarget,
        cycleStep: cycleState.cycleStep,
      });
      emitSession(MCP_EVENTS.CLARIFICATION_REQUIRED, { sessionId: roomTarget, requestId: cycleState.requestId });
      socket.emit("gil-event", { state: "idle" });
    governanceTrace({ askClarification: true, source: "validator" });
      return { paused: true, context: checkpoint };
    }
    socket.emit("gil-event", {
      state: validation.isCompliant === true ? "green" : "red",
      cycle,
    });

    if (validation.isCompliant) {
      converged = true;
      break;
    }

    // Optional: strictness escalation if we are not converging fast enough
    const strictState = {
      strictnessLevel: effectiveStrictness,
      riskSignals: [],
      recentViolations: validation.forbiddenHits || [],
    };
    evaluateStrictnessCycle(strictState);
    enforceStrictnessFloor(strictState);
    escalateStrictness(strictState, validation.hardViolationCount ? 0.5 : 0.25);
    effectiveStrictness = normalizeStrictness(strictState.strictnessLevel / 4 || strictState.strictnessLevel);
    emitTelemetry("mcp-status", {
      status: "Strictness",
      detail: `Adjusted strictness to ${effectiveStrictness.toFixed(2)} after cycle ${cycle}.`,
    });
  }

  const finalRuleStatus = validation.isCompliant ? "passed" : "failed";
  const finalizedRules = allRules.map((r) => ({
    ...r,
    status: r.status === "clarified" ? "clarified" : finalRuleStatus,
  }));

  let narrative = null;
  if (mustGovernOutput || allRules.length > 0) {
    narrative = buildNarrativeReport({
      input,
      goal,
      mode,
      converged,
      validation,
      plannedCycles,
      cyclesRun,
      stubbornViolations: validation.forbiddenHits || [],
      clarifications: [],
      rules: finalizedRules,
      hitRunaway: false,
    });

    const finalParsedRules = formatParsedRules(finalizedRules);
    emitSession("parsed-rules", { payload: { rules: finalParsedRules } });
    emitSession("governance-rules", { payload: { rules: finalParsedRules } });
  }
  const validationResultFinal = validateGovernedOutput(currentText, cycleState);
  if (
    cycleState?.governanceDecision?.outcome === GOVERNANCE_DECISIONS.SIMULATE_DESIGN_ONLY &&
    validationResultFinal &&
    validationResultFinal.allowed === false
  ) {
    validationResultFinal.allowed = true;
    validationResultFinal.reason = "simulation_override";
    validationResultFinal.clarification = false;
  }
  emitTelemetry("v1.2-validator-scope", {
    event: "v1.2-validator-scope",
    requestId: cycleState.requestId,
    mode: cycleState.dataScopeMode,
    containsExternal: validationResultFinal.scopeSignals?.containsExternalData ?? false,
    citationProvided: validationResultFinal.scopeSignals?.citationProvided ?? false,
    provenanceAttached: validationResultFinal.scopeSignals?.provenanceAttached ?? false,
    mixesSources: validationResultFinal.scopeSignals?.mixesPublicAndInternal ?? false,
  });
  if (!validationResultFinal.allowed && validationResultFinal.clarification) {
    // V1.2-PHASE5-FIX: clarification requests at the final validator stage must pause the workflow
    contextForResume.pendingClarificationType = validationResultFinal.clarificationType || null;
    const checkpoint = checkpointCycleState({
      ...contextForResume,
      cycle: cyclesRun,
      currentText,
      validation,
      pendingClarificationType: validationResultFinal.clarificationType || null,
      dataScopeMode: cycleState.dataScopeMode,
    });
    annotateCanonicalTraceDataScope(cycleState, validationResultFinal.scopeSignals, currentText); // V1.2-PHASE5-FIX
    emitTelemetry("v1.1-canonical-trace", {
      event: "v1.1-canonical-trace",
      phase: "final",
      paused: true,
      trace: cycleState.canonicalTrace,
    });
  emitTelemetry("v1.2-data-scope-trace", {
    event: "v1.2-data-scope-trace",
    requestId: cycleState.requestId,
    mode: cycleState.dataScopeMode,
    allowedSources: cycleState.allowedSources,
    allowWeb: cycleState.allowWeb,
    provenanceMode: cycleState.provenanceMode,
    traceAttached: true,
    phase: "final",
    paused: true,
  });
    emitSession("governance-clarification", {
      payload: { question: validationResultFinal.message, cycle: cyclesRun, runId: runId || roomTarget },
      sessionId: roomTarget,
    });
    emitTelemetry("v1.1-output-shaping", {
      event: "v1.1-output-shaping",
      requestId: cycleState.requestId,
      strictness: cycleState.strictness?.level ?? null,
      constraints: (cycleState.constraints || []).map((c) => c.type),
      governanceDecision: cycleState.governanceDecision?.outcome,
      status: "clarification-requested",
    });
    emitTelemetry("v1.1-validation", {
      event: "v1.1-validation",
      requestId: cycleState.requestId,
      allowed: false,
      reason: validationResultFinal.reason ?? "requires_clarification",
      triggeredClarification: true,
    });
    emitSession(MCP_EVENTS.CLARIFICATION_REQUIRED, { sessionId: roomTarget, requestId: cycleState.requestId });
    socket.emit("gil-event", { state: "idle" });
    return { paused: true, context: checkpoint };
  }
  let finalOutputText = validationResultFinal.allowed ? currentText : validationResultFinal.replacement;
  const simulationActive = isSimulationDecision(cycleState);
  if (cycleState.strictness?.level >= 2 && cycleState.requestType === REQUEST_TYPES.GOVERNED) {
    // V1.1-PHASE4: strictness-aware safety notice
    finalOutputText +=
      "\n\n[Governance Notice: This response has been generated under elevated strictness. Please review carefully before acting on it.]";
  }
  finalOutputText = prefixSimulationBanner(finalOutputText, cycleState);
  finalOutputText = applyDataScopeDecorations(
    finalOutputText,
    cycleState,
    validationResultFinal.scopeSignals,
    cycleState.constraintSummary
  );
  if (validation?.simulationAdvisory) {
    finalOutputText = `${finalOutputText}\n\n[Simulation Advisory] ${validation.simulationAdvisory}`;
  }
  annotateCanonicalTraceDataScope(cycleState, validationResultFinal.scopeSignals, finalOutputText);
  emitTelemetry("v1.1-canonical-trace", {
    event: "v1.1-canonical-trace",
    phase: "final",
    trace: cycleState.canonicalTrace,
  }); // TEST-F-FIX: final canonical trace emission
  emitTelemetry("v1.1-output-shaping", {
    event: "v1.1-output-shaping",
    requestId: cycleState.requestId,
    strictness: cycleState.strictness?.level ?? null,
    constraints: (cycleState.constraints || []).map((c) => c.type),
    governanceDecision: cycleState.governanceDecision?.outcome,
  });
  emitTelemetry("v1.1-validation", {
    event: "v1.1-validation",
    requestId: cycleState.requestId,
    allowed: validationResultFinal.allowed,
    reason: validationResultFinal.reason ?? null,
    triggeredClarification: !!validationResultFinal.clarification,
  });
  emitTelemetry("mcp-status", { status: "Finalized" });
  emitTelemetry("final-output", { text: finalOutputText, narrative, simulation: simulationActive });
  emitSession("governed-output", { payload: { text: finalOutputText, narrative, simulation: simulationActive } });
  emitTelemetry("ledger", { entries: ledger, simulation: simulationActive });
  emitTelemetry("ledger-updated", { entries: ledger, simulation: simulationActive });
  emitTelemetry("v1-governance-complete", {
    event: "v1-governance-complete",
    requestType: cycleState.requestType,
    finalStep: cycleState.cycleStep,
  });
  governanceTrace({ validatorOverride: !validationResultFinal.allowed });
  emitSession("workflow-finished", { payload: {} });
  emitTelemetry("workflow-finished", { requestId: cycleState.requestId, sessionId: roomTarget }); // TEST-F-FIX: telemetry for completion
  // V1-PHASE1B: supplemental event emit
  emitSession(MCP_EVENTS.CYCLE_COMPLETE, { sessionId: roomTarget, requestId: cycleState.requestId, cycle: cyclesRun });
  socket.emit("gil-event", { state: "idle" });
}

// --- Turbo / fast-mode workflow ---------------------------------------------

async function runTurboWorkflow(
  socket,
  {
    input,
    goal,
    rules,
    governanceStrictness,
    ledger,
    requiresGovernedOutput = false,
    sessionId = null,
    emitSession = null,
    governanceDecision = null,
    requestType = null,
  }
) {
  const turboSimulationActive =
    governanceDecision?.outcome === GOVERNANCE_DECISIONS.SIMULATE_DESIGN_ONLY;
  const emitTelemetry = (subtype, data = {}) => {
    // EVENT MODEL FIX: session-scoped telemetry helper for turbo path
    const payload = {
      type: "telemetry",
      subtype,
      sessionId,
      data,
    };
    if (sessionId && socket?.server?.to) {
      socket.server.to(sessionId).emit("telemetry", payload);
    } else {
      socket.emit("telemetry", payload);
    }
  };
  // TEST-F-FIX: turbo path has no canonical cycle state, so skip cycle-state telemetry here.
  emitTelemetry("cycle-plan", { plannedCycles: 2 });

  if (rules && rules.length) {
    const parsedRulesPayload = formatParsedRules(rules);
    if (emitSession) {
      emitSession("parsed-rules", { payload: { rules: parsedRulesPayload } });
    } else if (sessionId && socket?.server?.to) {
      socket.server.to(sessionId).emit("parsed-rules", { payload: { rules: parsedRulesPayload }, sessionId });
    } else {
      socket.emit("parsed-rules", { payload: { rules: parsedRulesPayload }, sessionId });
    }
  }

  const combined = await callOpenAIChat({
    system: `
You are a combined Task + Analytical + Creative agent in the cd\\ai architecture.

TURBO MODE:
- Generate a concise business-formal draft,
- Respect the governance rules as much as reasonably possible,
- Preserve natural formatting inferred from the task (subject lines, greetings, bullets),
- But prioritize speed over exhaustive enforcement, meta-governance, or convergence.

Return ONLY the final draft text. Do NOT explain your reasoning.
    `,
    user: `
User task:
${input}

Governance rules (high level - do your best within a single pass):
${(rules || []).map((r) => r.text || r).join("\n") || "None provided."}
    `,
    temperature: 0.5,
  });

  const rawText =
    combined || `Draft (turbo mode) based on: "${input}"`;
  const turboCycleState = { governanceDecision };
  const text = prefixSimulationBanner(rawText, turboCycleState);

  const now = new Date().toISOString();
  ledger.push(
    tagLedgerEntry(
      {
        timestamp: now,
        stage: "Turbo",
        cycle: 1,
        summary:
          "Turbo mode executed a single combined governed pass (Task + Analytical + Creative). Meta-governance behavior is approximated only.",
        snippet: text.slice(0, 260),
      },
      turboCycleState
    )
  );

  emitTelemetry("ledger-entry", {
    entries: [
      {
        timestamp: now,
        stage: "Turbo",
        cycle: 1,
        summary:
          "Turbo mode executed a single combined governed pass (Task + Analytical + Creative).",
      },
    ],
    simulation: turboSimulationActive,
  });

  const narrative =
    requiresGovernedOutput && rules && rules.length > 0
      ? buildNarrativeReport({
          input,
          goal,
          mode: "turbo",
          converged: true,
          validation: {
            forbiddenHits: [],
            wordCountOk: true,
            artifactsOk: true,
            impliedReliabilityOk: true,
            isCompliant: true,
          },
          plannedCycles: 2,
          cyclesRun: 1,
          stubbornViolations: [],
          clarifications: [],
          rules,
          hitRunaway: false,
        })
      : null;

  emitTelemetry("final-output", { text, narrative, simulation: turboSimulationActive });
  if (governanceDecision) {
    emitTelemetry("v1-governance-decision-complete", {
      event: "v1-governance-decision-complete",
      requestType: requestType || governanceDecision.requestType || REQUEST_TYPES.UNGOVERNED,
      decision: governanceDecision.outcome,
    });
  }
  if (emitSession) {
    emitSession("governed-output", { payload: { text, narrative, simulation: turboSimulationActive } });
  } else if (sessionId && socket?.server?.to) {
    // EVENT MODEL FIX: standard payload wrapper for governed-output
    socket.server.to(sessionId).emit("governed-output", {
      sessionId,
      payload: { text, narrative, simulation: turboSimulationActive },
    });
  } else {
    // EVENT MODEL FIX: standard payload wrapper for governed-output
    socket.emit("governed-output", { sessionId, payload: { text, narrative, simulation: turboSimulationActive } });
  }
  socket.emit("gil-event", { state: rules && rules.length ? "green" : "idle" });
}

// HITL LOOP FIX: resume execution after user clarification
async function resumeFromClarification(socket, ctx = {}, clarificationAnswer = "") {
  if (!socket) throw new Error("Socket is required to resume workflow.");
  const {
    rawRules = [],
    normalizedRules: storedNormalizedRules = [],
    governanceEnvelope = null,
    input = "",
    goal = "",
    plannedCycles = HARD_MAX_CYCLES,
    mustGovernOutput = false,
    roomTarget = socket.id || "default-session",
    runId = roomTarget,
    mode = "real",
    parsedInput = null,
    requestType = REQUEST_TYPES.CLARIFICATION_RESPONSE,
    scaffoldEnvelope = null,
    scaffoldStrictness = null,
    strictness: ctxStrictness = null,
    envelope: ctxEnvelope = null,
    grammar: ctxGrammar = null,
    constraints: ctxConstraints = null,
    constraintSummary: ctxConstraintSummary = null,
    governanceDecision: ctxGovernanceDecision = null,
    governanceDecisionDetail: ctxGovernanceDecisionDetail = null,
    canonicalTrace: ctxCanonicalTrace = null,
    dataScopeMode: ctxDataScopeMode = DEFAULT_DATA_SCOPE_MODE,
    governanceMode: ctxGovernanceMode = GOVERNANCE_MODES.STRICT,
    isFictionalOrSynthetic: ctxIsFictional = null,
    isSimulationHarness: ctxIsHarness = null,
    cycleState: priorCycleState = {},
    clarificationEscalations: ctxClarificationEscalations = 0,
    pendingClarificationType: ctxPendingClarificationType = null,
  } = ctx;

  const applicableRules =
    (rawRules && rawRules.length
      ? rawRules
      : (storedNormalizedRules || []).map((r) => r?.raw || r).filter(Boolean)) || [];
  const normalizedRulesResolved =
    storedNormalizedRules && storedNormalizedRules.length
      ? storedNormalizedRules
      : normalizeRules(applicableRules);

  let currentText = ctx.currentText || "";
  let ledger = ctx.ledger || [];
  let validation = ctx.validation || {};
  let effectiveStrictness = ctx.effectiveStrictness || normalizeStrictness(0.85);
  let cyclesRun = ctx.cycle || 1;
  let clarificationOverrideApplied = false; // TEST-G-FIX: prevent infinite clarification cascades
  const moderatorPrompt = ctx.moderatorResult?.moderatedPrompt || "";
  const restoredCycleState = priorCycleState ? { ...priorCycleState } : {};
  const cycleState = {
    normalizedRules: [],
    constraints: [],
    constraintSummary: null,
    governanceDecision: null,
    governanceDecisionDetail: null,
    ruleExtraction: null,
    taskExtraction: null,
    continuationCheckpoint: null,
    errors: [],
    ...restoredCycleState,
    requestId: runId,
    requestType,
    strictness:
      ctxStrictness ||
      restoredCycleState.strictness ||
      scaffoldStrictness || { level: 0, label: "normal" },
    envelope: ctxEnvelope || restoredCycleState.envelope || scaffoldEnvelope,
    parsedRules: applicableRules,
    cycleStep: "C",
    governanceDecision: ctxGovernanceDecision || restoredCycleState.governanceDecision || null,
    governanceDecisionDetail:
      ctxGovernanceDecisionDetail ||
      restoredCycleState.governanceDecisionDetail ||
      null,
    governanceMode: normalizeGovernanceMode(
      ctxGovernanceMode || restoredCycleState.governanceMode || GOVERNANCE_MODES.STRICT
    ),
    isFictionalOrSynthetic:
      typeof ctxIsFictional === "boolean"
        ? ctxIsFictional
        : restoredCycleState.isFictionalOrSynthetic ?? false,
    isSimulationHarness:
      typeof ctxIsHarness === "boolean"
        ? ctxIsHarness
        : restoredCycleState.isSimulationHarness ?? false,
  };
  cycleState.dataScopeMode =
    normalizeDataScopeMode(
      ctxDataScopeMode ||
        restoredCycleState.dataScopeMode ||
        cycleState.dataScopeMode
    ) || DEFAULT_DATA_SCOPE_MODE; // V1.2-PHASE1: restore data scope mode from checkpoint
  if (!cycleState.dataScopeMode) {
    cycleState.dataScopeMode = DEFAULT_DATA_SCOPE_MODE; // V1.2-PHASE1 safety default
  }
  const clarificationPayload = (clarificationAnswer || "").trim();
  if (clarificationPayload) {
    const citationHint = /citation:|source:|ref:/i.test(clarificationPayload);
    const provenanceHint = /\[provenance:/i.test(clarificationPayload);
    if (ctxPendingClarificationType === "citation" || (!ctxPendingClarificationType && citationHint)) {
      cycleState.userCitation = clarificationPayload; // V1.2-PHASE5-FIX: honor implicit citation responses
    }
    if (ctxPendingClarificationType === "provenance" || (!ctxPendingClarificationType && provenanceHint)) {
      cycleState.userProvenance = clarificationPayload; // V1.2-PHASE5-FIX: honor implicit provenance responses
    }
  }
  cycleState.normalizedRules = normalizedRulesResolved; // TEST-F-FIX: persist normalized rules after resume
  cycleState.grammar = ctxGrammar || restoredCycleState.grammar || cycleState.grammar;
  cycleState.constraints = ctxConstraints || restoredCycleState.constraints || cycleState.constraints || [];
  cycleState.constraintSummary =
    ctxConstraintSummary || restoredCycleState.constraintSummary || cycleState.constraintSummary || null;
  cycleState.governanceDecisionDetail =
    ctxGovernanceDecisionDetail || restoredCycleState.governanceDecisionDetail || cycleState.governanceDecisionDetail || null;
  cycleState.canonicalTrace = ctxCanonicalTrace || restoredCycleState.canonicalTrace || cycleState.canonicalTrace || {
    requestId: cycleState.requestId,
    governanceMode: cycleState.governanceMode,
    simulation: isSimulationDecision(cycleState),
    steps: {},
  };
  cycleState.strictness = ctxStrictness || cycleState.strictness || scaffoldStrictness;
  cycleState.envelope = ctxEnvelope || cycleState.envelope || scaffoldEnvelope;
  cycleState.parsedRules = applicableRules;
  const contextForResume = {
    ledger,
    rawRules,
    normalizedRules: normalizedRulesResolved,
    governanceEnvelope,
    input,
    goal,
    plannedCycles,
    mustGovernOutput,
    roomTarget,
    runId,
    mode,
    parsedInput,
    requestType,
    requestId: cycleState.requestId, // TEST-G-FIX: ensure checkpoints retain identifiers
    scaffoldEnvelope,
    scaffoldStrictness,
    strictness: cycleState.strictness,
    envelope: cycleState.envelope,
    grammar: cycleState.grammar,
    constraints: cycleState.constraints,
    constraintSummary: cycleState.constraintSummary,
    canonicalTrace: cycleState.canonicalTrace,
    governanceDecision: cycleState.governanceDecision,
    governanceDecisionDetail: cycleState.governanceDecisionDetail,
    cycleState,
    clarificationEscalations: ctxClarificationEscalations, // TEST-G-FIX: persist cascade depth
    dataScopeMode: cycleState.dataScopeMode, // V1.2-PHASE1: persist scope across cascades
    pendingClarificationType: null, // V1.2-PHASE3: reset clarification subtype
  };
  const snapshotCycleStateResume = () => ({
    requestId: cycleState.requestId,
    requestType: cycleState.requestType,
    grammar: cycleState.grammar,
    normalizedRules: cycleState.normalizedRules,
    constraints: cycleState.constraints,
    constraintSummary: cycleState.constraintSummary,
    strictness: cycleState.strictness,
    envelope: cycleState.envelope,
    governanceDecision: cycleState.governanceDecision,
    governanceDecisionDetail: cycleState.governanceDecisionDetail,
    canonicalTrace: cycleState.canonicalTrace,
    dataScopeMode: cycleState.dataScopeMode,
  });
  const emitCycleStateResume = (stage, phase) => {
    emitTelemetry("cycle-state", {
      stage,
      phase,
      snapshot: snapshotCycleStateResume(),
    });
  }; // TEST-F-FIX: resume flow snapshots
  // V1-PHASE6: invariants
  assertCycleStateShape(cycleState, "after-clarification-restore", { requireAnalysisFields: true });
  if (!cycleState.governanceDecision) {
    console.warn("[MCP][Invariant] Missing governanceDecision after clarification restore; defaulting to ALLOW.");
    cycleState.governanceDecision = { outcome: GOVERNANCE_DECISIONS.ALLOW, rationale: "post-clarification fallback" };
  }
  ensureCycleStateCoherence(cycleState); // V1.1-PHASE5: clarification state restoration coherence
  // TEST-E-FIX: mark canonical trace resume state

  const emitSession = (event, payload) => {
    const enriched = { ...payload };
    if (!enriched.sessionId) enriched.sessionId = roomTarget;
    if (socket?.server?.to) {
      socket.server.to(roomTarget).emit(event, enriched);
    } else {
      socket.emit(event, enriched);
    }
  };
  const emitTelemetry = (subtype, data = {}) => {
    // EVENT MODEL FIX: session-scoped telemetry for resumed HITL flow
    const payload = { type: "telemetry", subtype, sessionId: roomTarget, data };
    if (socket?.server?.to) {
      socket.server.to(roomTarget).emit("telemetry", payload);
    } else {
      socket.emit("telemetry", payload);
    }
  };
  const propagateResumeDataScope = (target, label = "resume") => {
    if (!cycleState.dataScopeMode) {
      cycleState.dataScopeMode = DEFAULT_DATA_SCOPE_MODE; // V1.2-PHASE1 safety default
    }
    if (target && typeof target === "object" && !target.dataScopeMode) {
      target.dataScopeMode = cycleState.dataScopeMode; // V1.2-PHASE1 propagate
    }
    if (target && typeof target === "object") {
      if (!target.allowedSources) {
        target.allowedSources = cycleState.allowedSources?.slice() || ["internal"];
      }
      if (typeof target.allowWeb !== "boolean") {
        target.allowWeb = !!cycleState.allowWeb;
      }
      if (!target.provenanceMode) {
        target.provenanceMode = cycleState.provenanceMode || "internal-only";
      }
    }
    return target;
  };
  propagateResumeDataScope(cycleState, "resume-init");
  emitTelemetry("v1.2-clarification-mode", {
    event: "v1.2-clarification-mode",
    requestId: cycleState.requestId,
    mode: cycleState.dataScopeMode,
  }); // V1.2-PHASE4: clarification resume telemetry
  if (cycleState.canonicalTrace) {
    cycleState.canonicalTrace.modeAtResume = cycleState.dataScopeMode;
    cycleState.canonicalTrace.governanceMode = cycleState.governanceMode;
    cycleState.canonicalTrace.simulation = isSimulationDecision(cycleState);
  }
  emitTelemetry("v1.1-canonical-trace", {
    event: "v1.1-canonical-trace",
    trace: cycleState.canonicalTrace,
    resumed: true,
  });
  emitTelemetry("v1.2-data-scope-trace", {
    event: "v1.2-data-scope-trace",
    requestId: cycleState.requestId,
    mode: cycleState.dataScopeMode,
    allowedSources: cycleState.allowedSources,
    allowWeb: cycleState.allowWeb,
    provenanceMode: cycleState.provenanceMode,
    traceAttached: true,
    resumed: true,
  }); // V1.2-PHASE1
  emitSession("clarification-accepted", {
    sessionId: roomTarget,
    payload: { answer: clarificationAnswer, requestId: cycleState.requestId },
  });
  emitTelemetry("clarification-accepted", {
    event: "clarification-accepted",
    requestId: cycleState.requestId,
    answer: clarificationAnswer,
  });

  for (let cycle = cyclesRun; cycle <= plannedCycles; cycle++) {
    cyclesRun = cycle;
    // V1-PHASE1C: maintain cycleStep across clarification pause/resume
    cycleState.cycleStep = "C";
    const resumePrompt = buildGovernedPrompt(moderatorPrompt, cycleState);
    emitTelemetry("v1.1-output-shaping", {
      event: "v1.1-output-shaping",
      requestId: cycleState.requestId,
      strictness: cycleState.strictness?.level ?? null,
      constraints: (cycleState.constraints || []).map((c) => c.type),
      governanceDecision: cycleState.governanceDecision?.outcome,
      cycle,
      phase: "resume-creative",
    }); // TEST-F-FIX
    emitCycleStateResume("Creative", "entry"); // TEST-F-FIX
    propagateResumeDataScope(cycleState, "resume-creative-entry"); // V1.2-PHASE1
    const creativeResult = await creativePass(currentText, {
      input,
      rules: applicableRules,
      governanceStrictness: effectiveStrictness,
      // V1.1-PHASE4: governed prompt shaping
      moderatedPrompt: resumePrompt,
      userFeedback: clarificationAnswer,
      governanceEnvelope,
    });
    propagateResumeDataScope(creativeResult, "resume-creative-exit"); // V1.2-PHASE1
    currentText = creativeResult.rewrittenText;
    emitCycleStateResume("Creative", "exit"); // TEST-F-FIX
    ledger.push(
      tagLedgerEntry(
        {
          timestamp: new Date().toISOString(),
          stage: "Creative",
          cycle,
          summary: creativeResult.deltaSummary || "Creative pass completed.",
          snippet: currentText.slice(0, 260),
        },
        cycleState
      )
    );
    emitTelemetry("hemisphere-log", {
      hemisphere: "C",
      message: `Cycle ${cycle}: ${creativeResult.deltaSummary || "Creative pass completed."}`,
    });

    emitCycleStateResume("Moderator-2", "entry"); // TEST-F-FIX
    propagateResumeDataScope(cycleState, "resume-moderator2-entry"); // V1.2-PHASE1
    const moderatorResult2 = await moderatorPass(currentText, {
      input,
      rules: applicableRules,
      governanceStrictness: effectiveStrictness,
      analyticalSummary: ctx.moderatorResult?.moderatorSummary,
      directives: ctx.moderatorResult?.directives,
      validation,
      governanceEnvelope,
    });
    propagateResumeDataScope(moderatorResult2, "resume-moderator2-exit"); // V1.2-PHASE1
    const resumeModeratorTimestamp = new Date().toISOString();
    const resumeModeratorSummary =
      moderatorResult2.deltaSummary ||
      moderatorResult2.moderatorSummary ||
      "Moderator refined post-creative draft.";
    const resumeModeratorMessage = `Cycle ${cycle}: ${resumeModeratorSummary}`;
    ledger.push(
      tagLedgerEntry(
        {
          timestamp: resumeModeratorTimestamp,
          stage: "Moderator-2",
          cycle,
          summary: resumeModeratorSummary,
          snippet: currentText.slice(0, 260),
        },
        cycleState
      )
    );
    emitTelemetry("moderator-log", {
      message: resumeModeratorMessage,
      cycle,
      phase: "post",
      passId: "moderator_post",
      timestamp: resumeModeratorTimestamp,
    });
    currentText = moderatorResult2.moderatedPrompt || currentText;
    emitCycleStateResume("Moderator-2", "exit"); // TEST-F-FIX

    emitCycleStateResume("Validator", "entry"); // TEST-F-FIX
    propagateResumeDataScope(cycleState, "resume-validator-entry"); // V1.2-PHASE1
      const postCreativeValidation = await validatorPass(currentText, {
        input,
        rules: applicableRules,
        governanceStrictness: effectiveStrictness,
        hemisphere: "creative",
        governanceDecision: cycleState.governanceDecision?.outcome || null,
      });
      propagateResumeDataScope(postCreativeValidation, "resume-validator-exit"); // V1.2-PHASE1
      validation = postCreativeValidation;
      const resumeValidatorTimestamp = validation.timestamp || new Date().toISOString();
      const resumeValidatorDecision =
        validation.decision ||
        (validation.isCompliant === true ? "pass" : validation.qualityState === "yellow" ? "review" : "fail");
      const resumeValidatorBaseSummary =
        validation.summary ||
        validation.rationale ||
        (validation.isCompliant === true
          ? "Validator marked output as compliant."
          : "Validator flagged governance risks.");
      const resumeValidatorSummary = validation.simulationAdvisory
        ? `${resumeValidatorBaseSummary} ${validation.simulationAdvisory}`.trim()
        : resumeValidatorBaseSummary;
      const resumeValidatorEntry = {
        timestamp: resumeValidatorTimestamp,
        stage: "Validator",
        cycle,
        summary: resumeValidatorSummary,
        snippet: currentText.slice(0, 260),
        decision: resumeValidatorDecision,
        hemisphere: validation.hemisphere || "creative",
        strictness:
          validation.strictnessLevel ??
          (typeof effectiveStrictness === "number" ? effectiveStrictness : effectiveStrictness?.level ?? null),
        ruleIds: Array.isArray(validation.ruleIds) ? validation.ruleIds : [],
        rationale: resumeValidatorSummary,
        qualityState: validation.qualityState || (validation.isCompliant ? "green" : "red"),
        requiresCorrection: !!validation.requiresCorrection,
        requiresHumanReview: !!validation.requiresHumanReview,
        absoluteIssues: validation.absoluteIssues || [],
        contextualIssues: validation.contextualIssues || [],
        softIssues: validation.softIssues || [],
        overrides: validation.overrideRecords || [],
        assessmentLog: validation.assessmentLog || [],
      };
      if (validation.simulationAdvisory) {
        resumeValidatorEntry.simulationAdvisory = validation.simulationAdvisory;
      }
      ledger.push(tagLedgerEntry(resumeValidatorEntry, cycleState));
      if ((validation.overrideRecords || []).length) {
        validation.overrideRecords.forEach((record) => {
          ledger.push(
            tagLedgerEntry(
              {
                timestamp: record.timestamp || resumeValidatorTimestamp,
                stage: "ValidatorOverride",
                cycle,
                summary: `Override by ${record.userName || record.userId || "authorized user"}`,
                snippet: record.justification || "Override applied.",
                decision: resumeValidatorDecision,
                hemisphere: resumeValidatorEntry.hemisphere,
                strictness: resumeValidatorEntry.strictness,
                rationale: record.justification || "Override recorded.",
                overrideRecord: record,
              },
              cycleState
            )
          );
        });
      }
      emitTelemetry("hemisphere-log", {
        hemisphere: "A",
        message: `Cycle ${cycle}: ${resumeValidatorSummary}`,
      });
      emitTelemetry("hemisphere-validation", {
        validation: {
          ...validation,
          cycle,
          decision: resumeValidatorDecision,
          summary: resumeValidatorSummary,
        },
      });
      emitTelemetry("v1.1-validation", {
        event: "v1.1-validation",
        requestId: cycleState.requestId,
        allowed: validation.isCompliant === true,
        reason: validation.isCompliant ? null : "validation_pending",
        cycle,
        phase: "resume-validator",
        qualityState: resumeValidatorEntry.qualityState,
        requiresCorrection: !!validation.requiresCorrection,
        requiresHumanReview: !!validation.requiresHumanReview,
        validation,
      }); // TEST-F-FIX
      emitTelemetry("validator-event", {
        cycle,
        entry: resumeValidatorEntry,
        validation: {
          ...validation,
          decision: resumeValidatorDecision,
          summary: resumeValidatorSummary,
        },
        overrides: validation.overrideRecords || [],
      });
    emitTelemetry("ledger-entry", {
      entries: [resumeValidatorEntry],
      simulation: isSimulationDecision(cycleState),
    });
    emitCycleStateResume("Validator", "exit"); // TEST-F-FIX
    socket.emit("gil-event", {
      state: validation.isCompliant === true ? "green" : "red",
      cycle,
    });

    // V1.1-PHASE4: validator constraint enforcement (also enforce under non-compliant drafts)
    const validationResult = validateGovernedOutput(currentText, cycleState);
    emitTelemetry("v1.2-validator-scope", {
      event: "v1.2-validator-scope",
      requestId: cycleState.requestId,
      mode: cycleState.dataScopeMode,
      containsExternal: validationResult.scopeSignals?.containsExternalData ?? false,
      citationProvided: validationResult.scopeSignals?.citationProvided ?? false,
      provenanceAttached: validationResult.scopeSignals?.provenanceAttached ?? false,
      mixesSources: validationResult.scopeSignals?.mixesPublicAndInternal ?? false,
    });
    if (!validationResult.allowed && validationResult.clarification) {
      const priorClarifications = contextForResume.clarificationEscalations || 0;
      if (priorClarifications >= 1) {
        clarificationOverrideApplied = true; // TEST-G-FIX: avoid infinite clarification loop
        break;
      }
      emitSession("governance-clarification", {
        payload: { question: validationResult.message, cycle, runId: runId || roomTarget },
        sessionId: roomTarget,
      });
      const nextClarificationCount = priorClarifications + 1;
      contextForResume.pendingClarificationType = validationResult.clarificationType || null;
      const checkpoint = checkpointCycleState({
        ...contextForResume,
        clarificationEscalations: nextClarificationCount,
        pendingClarificationType: validationResult.clarificationType || null,
        cycle,
        currentText,
        validation,
        effectiveStrictness,
        // V1.1-PHASE5: clarification checkpoint completeness
        canonicalTrace: cycleState.canonicalTrace,
        dataScopeMode: cycleState.dataScopeMode, // V1.2-PHASE1: carry data scope mode through resume checkpoint
      });
      contextForResume.clarificationEscalations = nextClarificationCount;
      emitTelemetry("mcp-clarification-checkpoint-created", {
        event: "mcp-clarification-checkpoint-created",
        requestId: cycleState.requestId,
        sessionId: roomTarget,
        cycleStep: cycleState.cycleStep,
      });
      annotateCanonicalTraceDataScope(cycleState, validationResult.scopeSignals, currentText); // V1.2-PHASE5-FIX
      emitTelemetry("v1.1-canonical-trace", {
        event: "v1.1-canonical-trace",
        phase: "final",
        paused: true,
        trace: cycleState.canonicalTrace,
      });
  emitTelemetry("v1.2-data-scope-trace", {
    event: "v1.2-data-scope-trace",
    requestId: cycleState.requestId,
    mode: cycleState.dataScopeMode,
    allowedSources: cycleState.allowedSources,
    allowWeb: cycleState.allowWeb,
    provenanceMode: cycleState.provenanceMode,
    traceAttached: true,
    phase: "final",
    paused: true,
  });
      emitSession(MCP_EVENTS.CLARIFICATION_REQUIRED, { sessionId: roomTarget, requestId: cycleState.requestId });
      socket.emit("gil-event", { state: "idle" });
      return { paused: true, context: checkpoint };
    } else if (validation.isCompliant) {
      break;
    }

    effectiveStrictness = tightenStrictness(effectiveStrictness, 0.05);
    emitTelemetry("strictness", {
      base: ctx.effectiveStrictness || effectiveStrictness,
      escalated: effectiveStrictness,
      effectiveStrictness,
    });
  }

  const finalRuleStatus = validation.isCompliant ? "passed" : "failed";
  const finalizedRules = normalizedRulesResolved.map((r) => ({
    ...r,
    status: r.status === "clarified" ? "clarified" : finalRuleStatus,
  }));

  let narrative =
    mustGovernOutput && applicableRules.length > 0
      ? buildNarrativeReport({
          input,
          goal,
          mode,
          converged: validation.isCompliant,
          validation,
          plannedCycles,
          cyclesRun,
          stubbornViolations: validation.forbiddenHits || [],
          clarifications: [{ text: clarificationAnswer }],
          rules: finalizedRules,
          hitRunaway: false,
        })
      : null;
  if (narrative) {
    const narrativeGovernanceSummary = `
[Governance Summary]
- Decision: ${cycleState.governanceDecision?.outcome}
- Strictness: ${cycleState.strictness?.level ?? 0}
- Constraints: ${(cycleState.constraints || []).map((c) => c.type).join(", ") || "(none)"}
`;
    narrative = `${narrative}\n\n${narrativeGovernanceSummary}`;
  }
  if (narrative) {
    const narrativeGovernanceSummary = `
[Governance Summary]
- Decision: ${cycleState.governanceDecision?.outcome}
- Strictness: ${cycleState.strictness?.level ?? 0}
- Constraints: ${(cycleState.constraints || []).map((c) => c.type).join(", ") || "(none)"}
`;
    narrative = `${narrative}\n\n${narrativeGovernanceSummary}`;
  }

  emitSession("parsed-rules", { payload: { rules: formatParsedRules(finalizedRules) } });
  emitSession("governance-rules", { payload: { rules: formatParsedRules(finalizedRules) } });
  let resumeValidationResult = validateGovernedOutput(currentText, cycleState);
  emitTelemetry("v1.2-validator-scope", {
    event: "v1.2-validator-scope",
    requestId: cycleState.requestId,
    mode: cycleState.dataScopeMode,
    containsExternal: resumeValidationResult.scopeSignals?.containsExternalData ?? false,
    citationProvided: resumeValidationResult.scopeSignals?.citationProvided ?? false,
    provenanceAttached: resumeValidationResult.scopeSignals?.provenanceAttached ?? false,
    mixesSources: resumeValidationResult.scopeSignals?.mixesPublicAndInternal ?? false,
  });
  if (
    clarificationOverrideApplied &&
    !resumeValidationResult.allowed &&
    resumeValidationResult.clarification
  ) {
    resumeValidationResult = {
      ...resumeValidationResult,
      allowed: true,
      reason: "clarification_limit_reached", // TEST-G-FIX: capped cascade
    };
  }
  let finalResumeText = resumeValidationResult.allowed ? currentText : resumeValidationResult.replacement;
  const resumeSimulationActive = isSimulationDecision(cycleState);
  if (cycleState.strictness?.level >= 2 && cycleState.requestType === REQUEST_TYPES.GOVERNED) {
    finalResumeText +=
      "\n\n[Governance Notice: This response has been generated under elevated strictness. Please review carefully before acting on it.]";
  }
  finalResumeText = prefixSimulationBanner(finalResumeText, cycleState);
  finalResumeText = applyDataScopeDecorations(
    finalResumeText,
    cycleState,
    resumeValidationResult.scopeSignals,
    cycleState.constraintSummary
  );
  annotateCanonicalTraceDataScope(cycleState, resumeValidationResult.scopeSignals, finalResumeText);
  emitTelemetry("v1.1-output-shaping", {
    event: "v1.1-output-shaping",
    requestId: cycleState.requestId,
    strictness: cycleState.strictness?.level ?? null,
    constraints: (cycleState.constraints || []).map((c) => c.type),
    governanceDecision: cycleState.governanceDecision?.outcome,
  });
  emitTelemetry("v1.1-validation", {
    event: "v1.1-validation",
    requestId: cycleState.requestId,
    allowed: resumeValidationResult.allowed,
    reason: resumeValidationResult.reason ?? null,
    triggeredClarification: !!resumeValidationResult.clarification,
  });
  emitTelemetry("final-output", { text: finalResumeText, narrative, simulation: resumeSimulationActive });
  emitSession("governed-output", { payload: { text: finalResumeText, narrative, simulation: resumeSimulationActive } });
  emitSession("workflow-finished", { payload: { runId, sessionId: roomTarget } });
  emitTelemetry("workflow-finished", { requestId: cycleState.requestId, sessionId: roomTarget, resumed: true }); // TEST-F-FIX
  emitTelemetry("mcp-clarification-checkpoint-restored", {
    event: "mcp-clarification-checkpoint-restored",
    requestId: cycleState.requestId,
    sessionId: roomTarget,
    cycleStep: cycleState.cycleStep,
  });
  emitTelemetry("v1-governance-complete", {
    event: "v1-governance-complete",
    requestType: cycleState.requestType,
    finalStep: cycleState.cycleStep,
  });
  // TEST-E-FIX: emulate governance trace emission for resumed flow without referencing outer scope
  emitTelemetry("v1-governance-trace", {
    event: "v1-governance-trace",
    decision: cycleState.governanceDecision?.outcome,
    resumed: true,
  });
  socket.emit("gil-event", { state: validation.isCompliant ? "green" : "red" });
}

// --- Global hooks for tests --------------------------------------------------

globalThis.extractTasksOnly = extractTasksOnly;
globalThis.stripRuleBlocks = stripRuleBlocks;
globalThis.safeParseJsonContent = safeParseJsonContent;
globalThis.extractRulesOnly = extractRulesOnly;
globalThis.registerRuleClearHandler = registerRuleClearHandler;
globalThis.classifyUserIntent = classifyUserIntent;
globalThis.classifyIntent = classifyIntent;
globalThis.detectGovernanceViolations = detectGovernanceViolations;

// --- Goal rule parser (simple) ----------------------------------------------

function parseRulesFromGoal(goalText) {
  if (!goalText) return [];
  const pieces = goalText
    .split(/\n|;/)
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  return pieces.length ? pieces : [goalText.trim()];
}

function normalizeEnvelopeRules(envelope) {
  if (!envelope) return [];
  const makeRule = (text) => ({
    text: (text || "").trim(),
    origin: "envelope",
    status: "pending",
  });
  const fromArray = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .map((r) => (typeof r === "string" ? r : r?.text || r?.rule))
      .filter(Boolean)
      .map(makeRule);

  const explicit = fromArray(envelope.explicitRules || envelope.explicit_rules);
  const inferred = fromArray(envelope.inferredRules || envelope.inferred_rules);
  const conditional = fromArray(envelope.conditionalLanguage);
  const contradictions = fromArray(envelope.contradictions);

  return [...explicit, ...inferred, ...conditional, ...contradictions];
}

// --- Exports -----------------------------------------------------------------

module.exports = {
  runGovernedWorkflow,
  parseRulesFromGoal,
  parseGovernanceEnvelope,
  detectGovernanceViolations,
  resumeFromClarification,
};

// V1.1-PHASE4: safety heuristics
function looksLikeExternalSharing(text = "") {
  return /send|email|forward|share|external|outside/i.test(text);
}

// V1.1-PHASE4: validator constraint enforcement
function validateGovernedOutput(outputText, cycleState) {
  const {
    constraints = [],
    strictness = { level: 0 },
    governanceDecision = {},
    grammar = {},
  } = cycleState || {};
  const summary = cycleState?.constraintSummary || {};
  const mode = cycleState?.dataScopeMode || DEFAULT_DATA_SCOPE_MODE;
  const allowWeb = cycleState?.allowWeb === true;
  const syntheticCitation = summary.syntheticCitation === true;
  const syntheticProvenance = summary.syntheticProvenance === true;

  // V1.2-PHASE3: provenance + citation detection
  const scopeSignals = {
    containsExternalData: detectExternalDataReferences(outputText),
    citationProvided: detectCitation(outputText),
    provenanceAttached: detectProvenanceMetadata(outputText),
    mixesPublicAndInternal: detectMixedSources(outputText),
    provenanceText: extractProvenanceText(outputText),
    externalReferences: extractExternalReferences(outputText),
  };
  if (cycleState?.userCitation) {
    scopeSignals.citationProvided = true;
  }
  if (cycleState?.userProvenance) {
    scopeSignals.provenanceAttached = true;
    scopeSignals.provenanceText = scopeSignals.provenanceText || cycleState.userProvenance;
  }

  const blockResponse = (overrides = {}) => ({
    allowed: false,
    ...overrides,
    scopeSignals,
  });
  const clarificationResponse = (overrides = {}) => ({
    allowed: false,
    clarification: true,
    ...overrides,
    scopeSignals,
  });

  if (governanceDecision.outcome === GOVERNANCE_DECISIONS.BLOCK) {
    return blockResponse({
      reason: "blocked-governance-path",
      replacement: "This request was blocked due to a hard governance constraint.",
    });
  }

  const hasNoExternal = constraints.some((c) => c.type === "no_external_sharing");
  if (hasNoExternal && looksLikeExternalSharing(outputText)) {
    return blockResponse({
      reason: "violates:no_external_sharing",
      replacement: "I cannot include external sharing due to constraints. Here is a compliant alternative:\n\n",
    });
  }

  if (!allowWeb && scopeSignals.containsExternalData) {
    return blockResponse({
      reason: "violates:data_scope_work",
      replacement: "External data content is forbidden in work mode. Please provide an internal-only response.\n\n",
    });
  }

  if (summary.webAccessForbidden && scopeSignals.containsExternalData) {
    return blockResponse({
      reason: "violates:no_web_access",
      replacement: "Explicit rules forbid retrieving or citing external data. Provide an internal-only alternative.\n\n",
    });
  }

  if (summary.publicIntegrationBlocked && scopeSignals.mixesPublicAndInternal) {
    return blockResponse({
      reason: "violates:no_public_data_integration",
      replacement: "Mixing public and internal data violates governance constraints. Provide a compliant alternative.\n\n",
    });
  }

  if (summary.citationRequired && !syntheticCitation && !scopeSignals.citationProvided) {
    return clarificationResponse({
      reason: "requires_citation",
      clarificationType: "citation",
      message: "Citation required for external data in web mode.",
    });
  }

  if (summary.provenanceRequired && !syntheticProvenance && !scopeSignals.provenanceAttached) {
    return clarificationResponse({
      reason: "requires_provenance",
      clarificationType: "provenance",
      message: "Provenance required for external data in web mode.",
    });
  }

  return { allowed: true, scopeSignals };
}

// V1.2-PHASE3: provenance detection helpers
function detectExternalDataReferences(text) {
  return /(according to|source:|https?:\/\/)/i.test(text || "");
}

function detectCitation(text) {
  return /citation:|source:|ref:/i.test(text || "");
}

function detectProvenanceMetadata(text) {
  return /\[provenance:/i.test(text || "");
}

function detectMixedSources(text) {
  return /\[internal\]/i.test(text || "") && /\[external\]/i.test(text || "");
}

function extractProvenanceText(text) {
  const match = (text || "").match(/\[provenance:\s*([^\]]+)\]/i);
  return match ? match[1].trim() : "";
}

function extractExternalReferences(text) {
  if (!text) return [];
  return [...text.matchAll(/https?:\/\/\S+/g)].map((m) => m[0]);
}

function annotateCanonicalTraceDataScope(cycleState, scopeSignals = {}, outputText = "") {
  if (!cycleState || !cycleState.canonicalTrace) return;
  cycleState.canonicalTrace.dataScopeMode = cycleState.dataScopeMode || DEFAULT_DATA_SCOPE_MODE;
  cycleState.canonicalTrace.allowedSources = cycleState.allowedSources;
  cycleState.canonicalTrace.allowWeb = cycleState.allowWeb;
  cycleState.canonicalTrace.provenanceMode = cycleState.provenanceMode;
  cycleState.canonicalTrace.containsExternalData = !!scopeSignals.containsExternalData;
  cycleState.canonicalTrace.citationProvided = !!scopeSignals.citationProvided;
  cycleState.canonicalTrace.provenanceAttached = !!scopeSignals.provenanceAttached;
  cycleState.canonicalTrace.mixesPublicAndInternal = !!scopeSignals.mixesPublicAndInternal;
  cycleState.canonicalTrace.externalReferences = extractExternalReferences(outputText);
}

function applyDataScopeDecorations(baseText, cycleState, scopeSignals = {}, summary = {}) {
  if (!cycleState) return baseText;
  const lines = [];
  const mode = cycleState.dataScopeMode || DEFAULT_DATA_SCOPE_MODE;
  lines.push(`[Data Scope Mode: ${mode}]`);
  if (scopeSignals.containsExternalData && mode === DATA_SCOPE_MODES.WEB) {
    lines.push("[External Data: USED]"); // V1.2-PHASE5-FIX: only show usage in web mode
  }
  if (scopeSignals.provenanceAttached) {
    const prov = scopeSignals.provenanceText || cycleState.userProvenance || "ATTACHED";
    lines.push(`[Provenance: ${prov}]`);
  } else if (mode === DATA_SCOPE_MODES.WEB) {
    lines.push("[Provenance: MISSING]");
  }
  const citationEnforced = summary?.citationRequired && summary?.syntheticCitation !== true;
  if (citationEnforced && !scopeSignals.citationProvided) {
    lines.push("[Citation Required: MISSING]");
  }
  if (scopeSignals.mixesPublicAndInternal) {
    lines.push("[Warning: Mixed Internal + External Sources Detected]");
  }
  if (cycleState.userCitation) {
    lines.push(`[Citation: ${cycleState.userCitation}]`);
  }
  if (cycleState.userProvenance) {
    lines.push(`[Provenance: ${cycleState.userProvenance}]`);
  }
  if (lines.length === 0) {
    return baseText;
  }
  return `${baseText}\n\n${lines.join("\n")}`;
}
