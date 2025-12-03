// workflow/runGovernedWorkflow.js
// Core governed workflow, dual-hemisphere passes, meta-governance engine,
// and unresolved-conflict escalation behavior.

require("dotenv").config();

// --- OpenAI config -----------------------------------------------------------

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL_NAME = "gpt-4o";
const {
  checkContextDrift,
  generateGovernanceNarrative,
  extractExplicitRulesViaAPI,
  inferRulesViaAPI,
} = require("./openaiClient");

const HARD_MAX_CYCLES = 25;

const CANONICAL_SECTIONS = ["Root Cause", "Remediation", "Governance Enhancement", "Leadership Summary"];

const COMMITMENT_REGEX =
  /\b(will|ensure|ensures|guarantee|guarantees|guaranteed|commit|commits|committed|fully implemented)\b/gi;
const CONFIDENCE_PHRASE_REGEX = /(\d{2,}\s*(confidence|certainty))\b/gi;
const PERCENT_REGEX = /\b\d+%\b/gi;
const ROLES_REGEX =
  /(task force|task forces|committee|committees|board|boards|team|teams|department|departments|oversight group|oversight groups|executive|executives|leadership team|leadership teams|data science group|data science groups)/gi;
const REGULATORY_REGEX =
  /(ISO(-)?like|regulatory alignment|audit-?ready|oversight parallels compliance|mapped to controls)/gi;
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
  "nist",
  "european union",
  "united nations",
  "department of defense",
  "us government",
];

function normalizeRuleObject(ruleText, { confidence = 0.78, rationale = "" } = {}) {
  if (typeof ruleText === "object" && ruleText !== null) return ruleText;
  return { text: String(ruleText || "").trim(), confidence, rationale };
}

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
  const rebuilt = CANONICAL_SECTIONS.map((section) => {
    const body = sections[section] || "Pending clarification; no content provided.";
    return `${section}:\n${body}`.trim();
  });

  return rebuilt.join("\n\n");
}

function replaceDeterministicLanguage(text) {
  let output = text.replace(COMMITMENT_REGEX, (m) => {
    if (/fully implemented/i.test(m)) return "partially implemented (subject to validation)";
    if (/guarantee/i.test(m)) return "avoid definitive promise";
    if (/ensure/i.test(m)) return "aim to support";
    if (/commit/i.test(m)) return "plan to";
    if (/will/i.test(m)) return "intend to";
    if (/%/.test(m) || /confidence|certainty|per\s+cent|percent/i.test(m))
      return "approximate (subject to validation)";
    return "aim to";
  });

  output = output.replace(DETERMINISTIC_NUMERIC_REGEX, "approximate (subject to validation)");
  output = output.replace(CONFIDENCE_PHRASE_REGEX, "approximate (subject to validation)");
  output = output.replace(PERCENT_REGEX, "approximate (subject to validation)");
  output = output.replace(FORMULA_REGEX, "calculation (approximate only)");
  output = output.replace(SPELLED_PERCENT_REGEX, "approximate (subject to validation)");
  output = output.replace(PROSE_FORMULA_REGEX, "calculation (approximate only)");
  return output;
}

function stripRolesAndRegulatory(text) {
  let output = text.replace(ROLES_REGEX, "cross-functional group");
  output = output.replace(REGULATORY_REGEX, "mapped to internal controls");
  return output;
}

function applyCycleOneFilters(text) {
  let output = coerceToCanonicalStructure(text);
  output = stripRolesAndRegulatory(output);
  output = replaceDeterministicLanguage(output);
  return output;
}

function isHighRiskTask(taskText = "") {
  const lower = (taskText || "").toLowerCase();
  const riskMarkers = ["legal", "contract", "policy", "audit", "regulator", "compliance", "obligation", "governance"];
  return riskMarkers.some((m) => lower.includes(m));
}

function computeStrictnessLevel({ intent, rules = [], taskLevelRules = [], tasks = [] } = {}) {
  let strictness = 2;
  const intentLabel = intent?.label || intent?.intent || intent || "";

  if (intentLabel.startsWith("rule_") || intentLabel === "governance_config") {
    strictness = Math.max(strictness, 3);
  }

  const combinedRulesCount = (rules || []).length + (taskLevelRules || []).length;
  const anyHighSeverity = []
    .concat(rules || [], taskLevelRules || [])
    .some((r) => (r?.severity || "").toLowerCase() === "high");
  if (combinedRulesCount > 5 || anyHighSeverity) {
    strictness += 1;
  }

  const anyHighRiskTask = (tasks || []).some((t) => isHighRiskTask(t));
  if (combinedRulesCount === 0 && (tasks || []).length === 1 && !anyHighRiskTask) {
    strictness = Math.max(0, strictness - 1);
  }
  if (anyHighRiskTask) {
    strictness = Math.min(4, strictness + 1);
  }

  if (strictness < 0) strictness = 0;
  if (strictness > 4) strictness = 4;
  console.debug(`[Governance] Strictness level for this request: ${strictness}`);
  return strictness;
}

if (!OPENAI_API_KEY) {
  console.warn(
    "[cd/ai] WARNING: OPENAI_API_KEY is not set. The workflow will fail until you set it in .env or Render env vars."
  );
}

// --- Pre-Cycle Governance Parser (PCGP) -------------------------------------
function parseGovernanceEnvelope(rawInputText) {
  const text = (rawInputText || "").trim();
  const lower = text.toLowerCase();

  const explicitRules = [];
  const inferredRules = [];
  const contradictions = [];
  const decoyInstruction = [];
  const conditionalLanguage = [];
  const metaWarnings = [];
  let requiresGovernedOutput = false;
  const hardResetRules =
    /\bapply only these rules\b/.test(lower) ||
    /\bignore all other rules\b/.test(lower) ||
    /\bonly these rules apply\b/.test(lower) ||
    /\bclear (all )?rules\b/.test(lower) ||
    /\breset (the )?rules\b/.test(lower) ||
    /\bdo not apply any governance logic other than what is listed here\b/.test(lower);

  const forbiddenContent = hardResetRules
    ? { percentages: false, mathFormulas: false, realInstitutions: false, roles: false }
    : {
        percentages: false,
        mathFormulas: false,
        realInstitutions: false,
        roles: false,
      };

  const safetyBoundaries = hardResetRules
    ? { noSpeculation: false, noLegalConclusions: false, conditionalLanguageOnly: false }
    : {
        noSpeculation: false,
        noLegalConclusions: false,
        conditionalLanguageOnly: false,
      };

  const toneSchema = {};

  const structureSchema = {
    requiredSections: [],
    orderEnforced: false,
    authoritativeSource: "user",
  };

  function addExplicit(textRule, confidence = 0.82, rationale = "") {
    explicitRules.push({ text: textRule, confidence, rationale });
  }

  function addInferred(textRule, confidence = 0.68, rationale = "") {
    inferredRules.push({ text: textRule, confidence, rationale });
  }

  const decoyPatterns = [
    "nasa hr",
    "operations dept",
    "operations department",
    "must include a guarantee",
    "create a formula",
    "use departments",
  ];

  decoyPatterns.forEach((p) => {
    if (lower.includes(p)) {
      decoyInstruction.push({
        text: `Decoy instruction detected: "${p}"`,
        confidence: 0.71,
        rationale: "Prompt contained distracting or contradictory governance text.",
      });
    }
  });

  if (!hardResetRules && (/\bno speculation\b|\bnot speculate\b|\bno guessing\b/.test(lower))) {
    safetyBoundaries.noSpeculation = true;
    addExplicit("Avoid speculation; flag missing information explicitly.", 0.86, "Prompt forbids speculation.");
  }
  if (!hardResetRules && (/\bno legal\b|\bno legal conclusions\b|\bavoid legal conclusions\b/.test(lower))) {
    safetyBoundaries.noLegalConclusions = true;
    addExplicit("Avoid legal conclusions or regulatory determinations.", 0.84, "Prompt forbids legal conclusions.");
  }
  if (!hardResetRules && (/\bno percentages\b|\bno percent\b|%\b/.test(lower))) {
    forbiddenContent.percentages = true;
    addExplicit("Avoid percentages unless unavoidable; prefer qualitative ranges.", 0.83, "Prompt mentions no %/formulas.");
  }
  if (!hardResetRules && (/\bno math\b|\bno formulas\b|\bmath formulas\b/.test(lower))) {
    forbiddenContent.mathFormulas = true;
    addExplicit("Do not include math formulas.", 0.82, "Prompt forbids formulas.");
  }
  if (!hardResetRules && (/\bno real (standards|institutions|regulations|governments|countries)\b/.test(lower))) {
    forbiddenContent.realInstitutions = true;
    addExplicit("Avoid real institutions/standards/regulations.", 0.83, "Prompt forbids real institutions.");
  }
  if (!hardResetRules && (/\bno roles?\b|\bno departments?\b|\bno teams?\b|\bno committees?\b|\bno boards?\b|\bno councils?\b|\bno ministries?\b/.test(lower))) {
    forbiddenContent.roles = true;
    addExplicit("Do not reference roles, departments, teams, committees, or boards.", 0.85, "Prompt forbids roles/departments.");
  }
  if (!hardResetRules && (/\bno regulators\b|\bavoid regulators\b|\bno regulatory\b/.test(lower))) {
    addExplicit("Avoid regulator mentions; use internal control language instead.", 0.78, "Prompt downplays regulators.");
  }
  if (!hardResetRules && (/\bno guaranteed\b|\bno guarantees\b|\bnot guaranteed\b|\bno commitments\b/.test(lower))) {
    addExplicit("Avoid commitments/guarantees/deterministic language.", 0.9, "Prompt forbids deterministic commitments.");
  }
  if (!hardResetRules && (/\bper\s+cent\b|percent\b/.test(lower))) {
    addExplicit("Avoid percentages unless unavoidable; prefer qualitative statements.", 0.76, "Prompt hints at % usage.");
  }
  if (!hardResetRules && (/\bformula\b|\bmath\b|\bequals\b/.test(lower))) {
    addExplicit("Avoid formulas/math expressions; keep qualitative.", 0.74, "Prompt hints at formulas.");
  }

  // Section governance (positive vs negative)
  const canonicalSectionMatchers = [
    { name: "Root Cause", pattern: /root cause/ },
    { name: "Remediation", pattern: /remediation/ },
    { name: "Governance Enhancement", pattern: /governance enhancement/ },
    { name: "Leadership Summary", pattern: /leadership summary/ },
  ];

  canonicalSectionMatchers.forEach(({ name, pattern }) => {
    const negative = new RegExp(
      `\\b(do not|don't|dont|avoid|exclude|omit|without|no)\\s+(?:the\\s+)?${pattern.source}`,
      "i"
    );
    if (negative.test(text)) {
      explicitRules.push({
        type: "forbidden_section",
        name,
        text: `Do not generate section: ${name}`,
        confidence: 0.9,
        rationale: "Rule text forbids this section.",
      });
    }
  });

  const positiveSectionCue =
    (/\b(include|use|structure|organize|provide)\b.*\bsections?\b/.test(lower) ||
      /\bsections?\s+(in\s+order|as follows|:)/.test(lower) ||
      /\bstructure (the )?(output|response) (into|around)/.test(lower)) &&
    !/\bdo not include sections\b/.test(lower);
  const mentionsCanonicalNames = canonicalSectionMatchers.some(({ pattern }) =>
    pattern.test(lower)
  );

  // Custom section extraction (non-canonical)
  const customSectionMatches = [];
  const customSectionRegex = /\b(summary of known information|missing information|known information|missing details)\b/gi;
  let m;
  while ((m = customSectionRegex.exec(text)) !== null) {
    const sectionName = m[1]
      .replace(/\bknown information\b/i, "Known Information")
      .replace(/\bmissing information\b/i, "Missing Information")
      .replace(/\bsummary of known information\b/i, "Summary of Known Information")
      .replace(/\bmissing details\b/i, "Missing Information");
    if (!customSectionMatches.includes(sectionName)) {
      customSectionMatches.push(sectionName);
    }
  }

  if (customSectionMatches.length > 0) {
    structureSchema.authoritativeSource = "prompt-explicit";
    structureSchema.requiredSections = customSectionMatches;
    structureSchema.orderEnforced = true;
    explicitRules.push({
      text: `Include sections in order: ${customSectionMatches.join(" > ")}`,
      origin: "user",
      status: "pending",
    });
  } else if (positiveSectionCue && mentionsCanonicalNames) {
    structureSchema.authoritativeSource = "prompt-explicit";
    structureSchema.requiredSections = [...CANONICAL_SECTIONS];
    structureSchema.orderEnforced = true;
    requiresGovernedOutput = true;
    explicitRules.push({
      text: `Include sections in order: ${structureSchema.requiredSections.join(" > ")}`,
      origin: "user",
      status: "pending",
    });
  }

  // Tone / summary rules only when explicitly requested
  if (/\banalytical tone\b/.test(lower) || /\btone\b.*analytical/.test(lower)) {
    toneSchema.analyticalTone = "crisp + hedged";
  }
  if (
    /\bexecutive summary\b.*plain language/.test(lower) ||
    /\bleadership summary\b.*plain language/.test(lower) ||
    /\bplain language summary\b/.test(lower)
  ) {
    toneSchema.executiveSummaryPlainLanguage = "reassuring + plain language";
  }

  if (!hardResetRules && (/\bcontradiction\b|\bconflict\b|\bmutually exclusive\b/.test(lower))) {
    addInferred("Surface contradictions explicitly and resolve in favor of latest explicit rule.", 0.7, "Prompt references contradictions.");
  }

  if (
    !hardResetRules &&
    (/\bcall out missing\b|\bif missing\b|\bif unclear\b|\bif vague\b|\blacking details\b/.test(lower))
  ) {
    addInferred("Flag missing information explicitly; do not invent details.", 0.82, "Prompt references missing info.");
    conditionalLanguage.push({
      text: "If inputs are unclear, flag missing info instead of guessing.",
      confidence: 0.78,
    });
  }

  const missingInformation =
    !hardResetRules &&
    (/\bcall out missing\b|\bif missing\b|\bmissing info\b|\bmissing information\b(?!\s*section)|\bvague\b|\bunclear\b|\binsufficient detail\b/.test(
      lower
    ));

  if (missingInformation && !conditionalLanguage.length) {
    conditionalLanguage.push({
      text: "Flag unclear inputs as missing information.",
      confidence: 0.75,
    });
  }

  const contradictoryGuarantee = /\bmust include a guarantee\b/.test(lower);
  const noGuarantee = /\bno guarantees\b|\bno commitments\b|\bavoid deterministic\b/.test(lower);
  if (contradictoryGuarantee && noGuarantee) {
    contradictions.push({
      text: "Guarantee requested but also forbidden; honor the prohibition.",
      confidence: 0.86,
    });
  }

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
    hardResetRules,
    requiresGovernedOutput,
  };
}

// --- Normalization helpers ---------------------------------------------------

function normalizeMaxCycles(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 5;
  return Math.min(10, Math.max(1, Math.round(n)));
}

function normalizeStrictness(raw) {
  const f = Number(raw);
  if (!Number.isFinite(f)) return 0.85;
  return Math.min(1, Math.max(0, f));
}

function normalizePerfMode(raw) {
  const v = (raw || "").toString().toLowerCase();
  if (v === "fast" || v === "turbo") return v;
  return "real";
}

function safeParseJsonContent(raw) {
  try {
    if (typeof raw !== "string") return raw;
    const trimmed = raw.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) throw new Error("Non-JSON response");
    return JSON.parse(trimmed);
  } catch (err) {
    try {
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        const sliced = raw.slice(start, end + 1).replace(/,\s*([}\]])/g, "$1");
        return JSON.parse(sliced);
      }
    } catch (_err) {
      return null;
    }
    return null;
  }
}

// --- User intent classifier --------------------------------------------------
async function classifyUserIntent(rawInputText) {
  const text = (rawInputText || "").trim();
  if (!text) {
    return { intent: "chat", confidence: 0.0 };
  }

  const system = `
You classify user messages for a governed AI system (cd\\ai).

Your job is to determine, at a high level, what the user is doing.

You MUST return JSON ONLY in this shape:
{
  "intent": "chat" | "task" | "rules" | "mixed",
  "confidence": 0.0-1.0,
  "reason": "short explanation"
}

Definitions:
- "chat": The user is talking conversationally, asking conceptual questions, venting, or exploring ideas.
         There is no clear request to perform a concrete task or produce an actionable governed output.
- "task": The user is clearly asking the system to DO something (draft an email, write a policy, design a process, etc).
          There may be some governance hints, but rules are not the main focus of the message.
- "rules": The user is primarily specifying, updating, or asking to clear / change governance rules, constraints, or policies.
           No concrete execution task is requested.
- "mixed": The user both describes a task AND provides governance rules/policies for how that task must be executed.

When in doubt:
- Prefer "task" if the user clearly wants an actionable output.
- Prefer "mixed" if they are giving both the task and explicit constraints/policies.
- Prefer "rules" only if the message is almost entirely about what rules apply, with no concrete task to execute now.
- Prefer "chat" for pure explanation / ideation / meta discussion.
`;

  const user = `User message:\n${text}`;

  const raw = await callOpenAIChat({
    system,
    user,
    temperature: 0,
    response_format: "json"
  });

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.intent !== "string") {
      throw new Error("Missing intent");
    }
    return parsed;
  } catch (err) {
    return {
      intent: "task",
      confidence: 0.3,
      reason: "Fallback: could not parse classifier JSON; defaulting to 'task'."
    };
  }
}

// --- Governance logging helper ---------------------------------------------
function logGovernanceEvent(ledger, { stage = "Governance", summary = "", cycle = 0, snippet = "" }) {
  ledger.push({
    timestamp: new Date().toISOString(),
    stage,
    cycle,
    summary,
    snippet: (snippet || "").toString().slice(0, 400),
  });
}

// --- Phase 1: tasks-only extraction ----------------------------------------
async function extractTasksOnly(rawText) {
  const system = `Extract TASKS ONLY from the user's input. Do NOT extract rules. Return JSON only:
{
  "tasks": [ "task1", "task2", ... ]
}`;

  const res = await callOpenAIChat({
    system,
    user: rawText,
    temperature: 0,
    response_format: "json",
  });

  try {
    const parsed = JSON.parse(res);
    if (!parsed || !Array.isArray(parsed.tasks)) {
      throw new Error("Unable to parse tasks JSON");
    }
    return { tasks: parsed.tasks, parse_error: false, raw_response: res };
  } catch (err) {
    return { tasks: [], parse_error: true, raw_response: res, error: String(err) };
  }
}

// --- Phase 2: rules-only extraction ----------------------------------------
async function extractRulesOnly(rawText) {
  const system = `Extract RULES ONLY from the user's input. Do NOT extract tasks. Return JSON only:
{
  "rules": {
    "explicit": [...],
    "general": [...],
    "candidateInferred": [...]
  }
}`;

  const res = await callOpenAIChat({
    system,
    user: rawText,
    temperature: 0,
    response_format: "json",
  });

  try {
    const parsed = JSON.parse(res);
    if (
      !parsed ||
      !parsed.rules ||
      (!Array.isArray(parsed.rules.explicit) &&
        !Array.isArray(parsed.rules.general) &&
        !Array.isArray(parsed.rules.candidateInferred))
    ) {
      throw new Error("Unable to parse rules JSON");
    }
    return {
      explicit: Array.isArray(parsed.rules.explicit) ? parsed.rules.explicit : [],
      general: Array.isArray(parsed.rules.general) ? parsed.rules.general : [],
      candidateInferred: Array.isArray(parsed.rules.candidateInferred)
        ? parsed.rules.candidateInferred
        : [],
      parse_error: false,
      raw_response: res,
    };
  } catch (err) {
    return {
      explicit: [],
      general: [],
      candidateInferred: [],
      parse_error: true,
      raw_response: res,
      error: String(err),
    };
  }
}

// --- Inference Confidence Model (ICM) --------------------------------------
function scoreInferredRule(rule, { contextText = "", priorTasks = [] } = {}) {
  const lowerRule = (rule || "").toLowerCase();
  const lowerContext = (contextText || "").toLowerCase();
  const contextualAlignment = lowerContext.includes(lowerRule) ? 1 : 0.6;
  const intentConsistency = 0.6;
  const publicKnowledgeScore = 0.5;
  const historicalContinuity = priorTasks.some((t) => (t || "").toLowerCase().includes(lowerRule)) ? 0.7 : 0.4;
  const ambiguityPenalty = lowerRule.split(" ").length > 14 ? 0.5 : 0.2;

  const confidence =
    0.3 * contextualAlignment +
    0.3 * intentConsistency +
    0.2 * publicKnowledgeScore +
    0.15 * historicalContinuity -
    0.15 * ambiguityPenalty;

  return Math.max(0, Math.min(1, confidence));
}

async function resolveMediumConfidenceRule(socket, rule, confidence, cycle, ledger) {
  // HITL prompt for medium-confidence inferred rules. The awaiting state is tracked on the socket
  // so that a subsequent user message can be interpreted as a confirmation instead of a new task.
  const question = `I inferred the following rule based on your input: "${rule}". Confidence: ${confidence.toFixed(
    2
  )}. Should I include this rule? (yes/no/clarify)`;

  // Expose pending state early so that any immediate acknowledgement (e.g., automated test harness)
  // is captured even if it fires in the same tick as the prompt emission.
  socket._pendingClarification = { cycle, ruleText: rule, type: "inferred-rule" };
  socket._pendingInferredRule = { text: rule, confidence, scope: "task_level" };
  const waitPromise = waitForUserClarification(socket, { cycle });

  socket.emit("telemetry", {
    type: "governance-response",
    text: question,
    confidence,
  });

  logGovernanceEvent(ledger, {
    stage: "RuleInference",
    cycle,
    summary: `HITL confirmation requested for inferred rule (${confidence.toFixed(2)}): ${rule}`,
    snippet: rule,
  });

  const answer = await waitPromise;
  socket._pendingInferredRule = null;
  const normalized = (answer || "").toLowerCase();
  const hasClarifyText = normalized.startsWith("clarify:");
  if (hasClarifyText) {
    const clarified = answer.slice(answer.indexOf(":") + 1).trim();
    return { decision: "clarify", ruleText: clarified || rule };
  }
  if (normalized.startsWith("clarify")) {
    return { decision: "clarify-needed", ruleText: rule };
  }
  if (normalized.startsWith("y") || normalized.includes("include") || normalized.includes("ok")) {
    return { decision: "yes", ruleText: rule };
  }
  if (normalized.startsWith("n")) {
    return { decision: "no", ruleText: rule };
  }
  return { decision: "no", ruleText: rule };
}

// --- Rule commit helper -----------------------------------------------------
function normalizeRuleArray(arr) {
  return (arr || [])
    .map((r) => (typeof r === "string" ? r : r.text || ""))
    .map((r) => r.trim())
    .filter(Boolean);
}

function commitRulesToState(state, explicit, general, inferred) {
  const dedupe = (list) => Array.from(new Set(list));
  state.explicitRules = dedupe(explicit).map((r) => ({ text: r, origin: "user", status: "pending" }));
  state.generalRules = dedupe(general).map((r) => ({ text: r, origin: "user", status: "pending" }));
  state.inferredRules = dedupe(inferred).map((r) => ({ text: r, origin: "system", status: "pending" }));

  state.activeRules = [...state.explicitRules, ...state.generalRules, ...state.inferredRules];
}

function shouldAttemptRuleExtraction(inputText) {
  if (!inputText) return false;

  // Strong governance keywords
  const governanceMarkers = [
    "rule",
    "rules",
    "section requirements",
    "prohibited",
    "allowed",
    "your output must",
    "must include",
    "do not generate",
    "final control rule",
  ];

  const lowered = inputText.toLowerCase();
  return governanceMarkers.some((m) => lowered.includes(m));
}

// --- Final output guard -----------------------------------------------------
function emitFinalOutputOnce(socket, state, text, narrative = null) {
  if (state && state._finalOutputSent) return;
  socket.emit("telemetry", { type: "final-output", text, narrative });
  if (state) state._finalOutputSent = true;
}

async function runUngovernedTask(socket, text, perfMode, state = null) {
  const reply =
    (await callOpenAIChat({
      system:
        "You are cd/ai operating in ungoverned mode. Respond helpfully to the user's task without applying governance scaffolding.",
      user: text,
      temperature: perfMode === "turbo" ? 0.6 : 0.4,
    })) ||
    "I completed the task in ungoverned mode.";

  socket.emit("telemetry", {
    type: "mcp-status",
    status: "Ungoverned",
    detail: "No governance rules detected; ran as plain task.",
  });
  emitFinalOutputOnce(socket, state, reply, null);
}

// Allow external clear of rules via socket event
function registerRuleClearHandler(socket, state) {
  socket.on("clear-rules", () => {
    state.activeRules = [];
    state.explicitRules = [];
    state.generalRules = [];
    state.inferredRules = [];
    socket.emit("telemetry", {
      type: "governance-rules",
      rules: [],
    });
  });
}

// --- Task enqueue helper ----------------------------------------------------
async function enqueueTasks(tasks, submitTaskToWorkflow) {
  for (const task of tasks) {
    await submitTaskToWorkflow(task);
  }
}
// --- Utility: isolate rules block (best-effort) for API extraction ---------
function extractRulesBlock(raw) {
  if (!raw) return "";
  const lower = raw.toLowerCase();
  const idx = lower.indexOf("rules");
  if (idx === -1) return raw;
  return raw.slice(idx);
}

// --- Inference helpers ------------------------------------------------------

function contradictsExplicitRules(inferred, explicitRules) {
  const text = (inferred?.text || "").toLowerCase();
  const name = (inferred?.name || "").toLowerCase();
  return explicitRules.some((r) => {
    const rt = (r.text || r.name || "").toLowerCase();
    const forbids = /\b(do not|don't|dont|avoid|exclude|omit|forbid|prohibit)\b/.test(rt);
    const requires = /\b(include|must include|structure|required)\b/.test(rt);
    if (!text && !name) return false;
    const target = name || text;
    const overlap =
      (rt && target && rt.includes(target)) ||
      (rt && target && target.includes(rt));
    return overlap && ((forbids && !/\bpropose\b/.test(rt)) || (requires && /\bdo not\b/.test(text)));
  });
}

function computeInferredConfidence(candidate, { input, explicitRules }) {
  let score =
    typeof candidate.confidence === "number"
      ? candidate.confidence
      : 0.6;
  const text = (candidate.text || "").toLowerCase();
  const name = (candidate.name || "").toLowerCase();
  const target = text || name;
  if (input && target && input.toLowerCase().includes(target)) {
    score += 0.1;
  }
  if (explicitRules.some((r) => (r.text || "").toLowerCase().includes(target))) {
    score -= 0.1;
  }
  return Math.max(0, Math.min(1, score));
}

async function verifyAndMaybeActivateInferredRules({
  candidates,
  explicitRules,
  rules,
  ledger,
  socket,
  cycle,
  input,
}) {
  const list = Array.isArray(candidates) ? candidates : [];
  for (const c of list) {
    const text = (c.text || "").trim();
    if (!text) continue;

    const confidence = computeInferredConfidence(c, { input, explicitRules });
    const incompatible = contradictsExplicitRules(c, explicitRules);

    const ledgerBase = {
      timestamp: new Date().toISOString(),
      stage: "InferredRule",
      cycle,
      snippet: text.slice(0, 260),
      confidence,
    };

    if (incompatible) {
      ledger.push({
        ...ledgerBase,
        summary: `Rejected inferred rule (conflict with explicit rules): ${text}`,
        compatibility: "conflict",
        hitl: false,
        outcome: "rejected",
      });
      continue;
    }

    if (confidence < 0.5) {
      ledger.push({
        ...ledgerBase,
        summary: `Discarded low-confidence inferred rule (${confidence.toFixed(2)}): ${text}`,
        compatibility: "ok",
        hitl: false,
        outcome: "rejected",
      });
      continue;
    }

    if (confidence >= 0.85) {
    rules.push({
      text,
      origin: "system",
      status: "pending",
      confidence,
    });
    ledger.push({
      ...ledgerBase,
      summary: `Auto-accepted high-confidence inferred rule (${confidence.toFixed(2)}): ${text}`,
      compatibility: "ok",
      hitl: false,
      outcome: "accepted",
    });
    socket.emit("telemetry", { type: "governance-rules", rules });
    continue;
  }

    // Medium confidence -> HITL
    ledger.push({
      ...ledgerBase,
      summary: `HITL confirmation required for inferred rule (${confidence.toFixed(2)}): ${text}`,
      compatibility: "ok",
      hitl: true,
      outcome: "pending",
    });

    socket.emit("telemetry", {
      type: "governance-response",
      text: `I inferred the following rule based on your input: "${text}". Confidence: ${confidence.toFixed(
        2
      )}. Should I include this rule? (yes/no/clarify)`,
      cycle,
    });

    const userAnswer = await waitForUserClarification(socket, { cycle });
    const normalized = (userAnswer || "").toLowerCase();
    const approved =
      normalized.startsWith("y") || normalized.includes("include") || normalized.includes("ok");
    if (approved) {
      rules.push({
        text,
        origin: "user-clarified",
        status: "pending",
        confidence,
      });
      ledger.push({
        ...ledgerBase,
        summary: `User approved inferred rule (${confidence.toFixed(2)}): ${text}`,
        hitl: true,
        outcome: "accepted",
      });
      socket.emit("telemetry", { type: "governance-rules", rules });
    } else {
      ledger.push({
        ...ledgerBase,
        summary: `User rejected inferred rule (${confidence.toFixed(2)}): ${text}`,
        hitl: true,
        outcome: "rejected",
      });
    }
  }
  return rules;
}

// --- Validation state --------------------------------------------------------

function initialValidationState() {
  return {
    forbiddenHits: [],
    wordCountOk: true,
    artifactsOk: true,
    impliedReliabilityOk: true,
    isCompliant: false,
    overall_score: 1,
  };
}

function validationSummary(v) {
  const issues = [];
  if (!v.wordCountOk) issues.push("WORD_COUNT");
  if (!v.artifactsOk) issues.push("ARTIFACTS");
  if (!v.impliedReliabilityOk) issues.push("IMPLIED_RELIABILITY");
  if (v.forbiddenHits?.length)
    issues.push(`FORBIDDEN: ${v.forbiddenHits.join(", ")}`);
  const scoreText =
    typeof v.overall_score === "number"
      ? ` | score=${v.overall_score.toFixed(2)}`
      : "";
  return issues.length
    ? `Violations: ${issues.join("; ")}${scoreText}`
    : `All constraints satisfied.${scoreText}`;
}

function detectGovernanceViolations(text, { cycle } = {}) {
  const body = text || "";
  const lower = body.toLowerCase();
  const sections = extractSections(body);
  const boundaries = getSectionBoundaries(body);

  const hits = [];
  const riskyTokens = new Set();
  let structureOk = true;

  function findSectionForIndex(idx) {
    for (const b of boundaries) {
      if (idx >= b.index && idx <= b.end) return b.name;
    }
    return null;
  }

  function addHit({
    matchIndex = 0,
    snippet,
    severity = "hard",
    section,
    confidence = 0.78,
    rule = "unspecified",
  }) {
    const resolvedSection =
      section || findSectionForIndex(matchIndex) || "global";
    const cleanedSnippet = (snippet || "").toString().slice(0, 200);
    hits.push({
      section: resolvedSection,
      rule,
      snippet: cleanedSnippet,
      severity,
      confidence,
    });
  }

  // Structure enforcement (exact order, no extras, no merges)
  const headingNames = boundaries.map((b) => b.name);
  const placeholderText = "Pending clarification; no content provided.";
  const missingSections = CANONICAL_SECTIONS.filter(
    (section) => !headingNames.includes(section)
  );
  missingSections.forEach((section) => {
    structureOk = false;
    addHit({
      snippet: `Missing required section: ${section}`,
      severity: "hard",
      confidence: 0.9,
      rule: "structure:missing",
    });
  });
  CANONICAL_SECTIONS.forEach((section) => {
    const content = sections[section];
    if (
      headingNames.includes(section) &&
      (!content || content.trim() === "" || content.trim() === placeholderText)
    ) {
      structureOk = false;
      addHit({
        snippet: `Section "${section}" is empty or placeholder-only.`,
        severity: "hard",
        confidence: 0.82,
        rule: "structure:missing",
      });
    }
  });

  const extraHeadings = headingNames.filter(
    (name) => !CANONICAL_SECTIONS.includes(name)
  );
  extraHeadings.forEach((name) => {
    structureOk = false;
    addHit({
      snippet: `Extra section detected: ${name}`,
      severity: "hard",
      confidence: 0.78,
      rule: "structure:extra",
    });
  });

  if (headingNames.length && headingNames.length !== CANONICAL_SECTIONS.length) {
    structureOk = false;
    addHit({
      snippet: `Section count mismatch. Expected ${CANONICAL_SECTIONS.length}, found ${headingNames.length}.`,
      severity: "hard",
      confidence: 0.82,
      rule: "structure:count",
    });
  }

  // Duplicate canonical headings
  const headingFrequency = headingNames.reduce((acc, name) => {
    const key = name || "";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  Object.entries(headingFrequency).forEach(([name, count]) => {
    if (count > 1) {
      structureOk = false;
      addHit({
        snippet: `Duplicate canonical section detected: ${name} (appears ${count} times).`,
        severity: "hard",
        confidence: 0.81,
        rule: "structure:duplicate",
      });
    }
  });

  const outOfOrder =
    headingNames.length === CANONICAL_SECTIONS.length &&
    headingNames.some((name, idx) => name !== CANONICAL_SECTIONS[idx]);
  if (outOfOrder) {
    structureOk = false;
    addHit({
      snippet: `Section order mismatch. Expected ${CANONICAL_SECTIONS.join(
        " > "
      )}; received ${headingNames.join(" > ")}.`,
      severity: "hard",
      confidence: 0.85,
      rule: "structure:order",
    });
  }

  const observedHeadingText = new Set();
  const arbitraryHeadingRegex =
    /(?:^|\n)\s*([A-Z][A-Za-z\s]+):\s*$/gm;
  let arbitraryMatch;
  while ((arbitraryMatch = arbitraryHeadingRegex.exec(body)) !== null) {
    const name = (arbitraryMatch[1] || "").trim();
    if (!name) continue;
    if (observedHeadingText.has(name.toLowerCase())) continue;
    observedHeadingText.add(name.toLowerCase());
    if (!CANONICAL_SECTIONS.includes(name)) {
      structureOk = false;
      addHit({
        snippet: `Non-canonical section detected: ${name}`,
        severity: "hard",
        confidence: 0.76,
        rule: "structure:extra",
      });
    }
  }

  const mergedHeadingPattern =
    /(?:^|\n)\s*([A-Za-z\s]+(?:\/|&|\+| and )[A-Za-z\s]+)\s*[:\-]?\s*$/gm;
  let mergedMatch;
  while ((mergedMatch = mergedHeadingPattern.exec(body)) !== null) {
    const header = mergedMatch[1] || "";
    const normalized = header.toLowerCase();
    const canonicalMentions = CANONICAL_SECTIONS.filter((section) =>
      normalized.includes(section.toLowerCase())
    );
    if (canonicalMentions.length >= 2) {
      structureOk = false;
      addHit({
        snippet: `Merged/combined sections detected: "${header.trim()}"`,
        severity: "hard",
        confidence: 0.83,
        rule: "structure:merged",
      });
    }
  }

  // Hard rules: commitments/deterministic
  const commitmentRegex = new RegExp(COMMITMENT_REGEX.source, "gi");
  let m;
  while ((m = commitmentRegex.exec(body)) !== null) {
    riskyTokens.add(m[0].toLowerCase());
    addHit({
      matchIndex: m.index,
      snippet: `Deterministic/commitment phrase "${m[0]}"`,
      severity: "hard",
      confidence: 0.86,
      rule: "language:absolute",
    });
  }

  const percentRegex = new RegExp(PERCENT_REGEX.source, "gi");
  while ((m = percentRegex.exec(body)) !== null) {
    riskyTokens.add(m[0].toLowerCase());
    addHit({
      matchIndex: m.index,
      snippet: `Percentage detected "${m[0]}"`,
      severity: "hard",
      confidence: 0.86,
      rule: "language:percent",
    });
  }

  const confidenceRegex = new RegExp(CONFIDENCE_PHRASE_REGEX.source, "gi");
  while ((m = confidenceRegex.exec(body)) !== null) {
    riskyTokens.add(m[0].toLowerCase());
    addHit({
      matchIndex: m.index,
      snippet: `Deterministic confidence phrase "${m[0]}"`,
      severity: "hard",
      confidence: 0.82,
      rule: "language:confidence",
    });
  }

  const rolesRegex = new RegExp(ROLES_REGEX.source, "gi");
  while ((m = rolesRegex.exec(body)) !== null) {
    riskyTokens.add(m[0].toLowerCase());
    addHit({
      matchIndex: m.index,
      snippet: `Role/department mention "${m[0]}"`,
      severity: "hard",
      confidence: 0.83,
      rule: "references:role",
    });
  }

  const regRegex = new RegExp(REGULATORY_REGEX.source, "gi");
  while ((m = regRegex.exec(body)) !== null) {
    riskyTokens.add(m[0].toLowerCase());
    addHit({
      matchIndex: m.index,
      snippet: `Regulatory-adjacent phrase "${m[0]}"`,
      severity: "hard",
      confidence: 0.8,
      rule: "references:regulatory",
    });
  }

  const formulaRegex = new RegExp(FORMULA_REGEX.source, "gi");
  while ((m = formulaRegex.exec(body)) !== null) {
    riskyTokens.add(m[0].toLowerCase());
    addHit({
      matchIndex: m.index,
      snippet: `Formula/numeric expression "${m[0]}"`,
      severity: "hard",
      confidence: 0.8,
      rule: "forbidden:formula",
    });
  }

  const proseFormulaRegex = new RegExp(PROSE_FORMULA_REGEX.source, "gi");
  while ((m = proseFormulaRegex.exec(body)) !== null) {
    riskyTokens.add(m[0].toLowerCase());
    addHit({
      matchIndex: m.index,
      snippet: `Formula-as-prose expression "${m[0]}"`,
      severity: "hard",
      confidence: 0.78,
      rule: "forbidden:formula-prose",
    });
  }

  const spelledPercentRegex = new RegExp(SPELLED_PERCENT_REGEX.source, "gi");
  while ((m = spelledPercentRegex.exec(body)) !== null) {
    riskyTokens.add(m[0].toLowerCase());
    addHit({
      matchIndex: m.index,
      snippet: `Spelled-out percentage "${m[0]}"`,
      severity: "hard",
      confidence: 0.8,
      rule: "language:percent-spelled",
    });
  }

  const deterministicNumericRegex = new RegExp(
    DETERMINISTIC_NUMERIC_REGEX.source,
    "gi"
  );
  while ((m = deterministicNumericRegex.exec(body)) !== null) {
    riskyTokens.add(m[0].toLowerCase());
    addHit({
      matchIndex: m.index,
      snippet: `Deterministic numeric "${m[0]}"`,
      severity: "hard",
      confidence: 0.82,
      rule: "language:deterministic-numeric",
    });
  }

  REAL_INSTITUTIONS.forEach((inst) => {
    if (lower.includes(inst)) {
      riskyTokens.add(inst);
      addHit({
        snippet: `Real institution reference "${inst}"`,
        severity: "hard",
        confidence: 0.76,
        rule: "forbidden:real-institution",
      });
    }
  });

  // Tone & near-violations
  const leadership = sections["Leadership Summary"] || "";
  if (leadership) {
    const leadershipDeterministic = leadership.match(
      /\b(ensure|guarantee|will|commit)\b/i
    );
    if (leadershipDeterministic) {
      riskyTokens.add(leadershipDeterministic[0].toLowerCase());
      addHit({
        snippet: `Leadership deterministic verb "${leadershipDeterministic[0]}"`,
        section: "Leadership Summary",
        severity: "hard",
        confidence: 0.82,
        rule: "language:absolute",
      });
    }
  }

  const analyticalSections = [
    sections["Root Cause"],
    sections["Remediation"],
    sections["Governance Enhancement"],
  ].filter(Boolean);
  analyticalSections.forEach((sectionText, idx) => {
    const hasHedging = /\b(may|could|might|aim|plan|intend|designed to|approximate|subject to validation)\b/i.test(
      sectionText
    );
    if (!hasHedging && sectionText.trim().length > 0) {
      addHit({
        snippet: `Analytical section ${idx + 1} lacks hedging language.`,
        section:
          idx === 0
            ? "Root Cause"
            : idx === 1
            ? "Remediation"
            : "Governance Enhancement",
        severity: "warning",
        confidence: 0.65,
        rule: "tone:hedging",
      });
    }
  });

  const forbiddenHits = hits
    .filter((h) => h.severity === "hard")
    .map((h) => h.snippet);

  const impliedReliabilityOk =
    forbiddenHits.filter((h) =>
      /deterministic|numeric|%|per\s+cent|guarantee|ensure|will|commit|expected|confidence|certainty/i.test(
        h
      )
    ).length === 0;

  const hardCount = hits.filter((h) => h.severity === "hard").length;
  const warningCount = hits.filter((h) => h.severity === "warning").length;
  const precisionScore = Math.max(
    0,
    Number((1 - hardCount * 0.12 - warningCount * 0.05).toFixed(2))
  );
  const overallScore = Math.max(
    0,
    Number(
      (
        1 -
        hardCount * 0.15 -
        warningCount * 0.07 -
        (structureOk ? 0 : 0.15)
      ).toFixed(2)
    )
  );

  return {
    forbiddenHits,
    wordCountOk: true,
    artifactsOk: structureOk,
    impliedReliabilityOk,
    isCompliant: structureOk && hardCount === 0,
    detailedHits: hits,
    precisionScore,
    overall_score: overallScore,
    hardViolationCount: hardCount,
    warningCount,
    riskyTokens: [...riskyTokens],
    cycleContext: cycle ?? null,
  };
}

// --- Rules parser ------------------------------------------------------------

function parseRulesFromGoal(goalText) {
  if (!goalText) return [];
  const pieces = goalText
    .split(/\n|;/)
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  return pieces.length ? pieces : [goalText.trim()];
}

// --- MCP <-> user clarification loop ------------------------------------------

function waitForUserClarification(socket, { cycle }) {
  return new Promise((resolve) => {
    let settled = false;
    const timeoutMs = 120000; // 2 minutes

    function cleanup() {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      socket.off("clarification-response", onResponse);
      socket._pendingClarification = null;
    }

    function onResponse(payload) {
      if (!payload) return;
      if (
        typeof payload.cycle === "number" &&
        typeof cycle === "number" &&
        payload.cycle !== cycle
      ) {
        return;
      }

      cleanup();
      const answer =
        typeof payload.answer === "string" ? payload.answer.trim() : "";
      resolve(answer || null);
    }

    const timeoutId = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);

    socket.on("clarification-response", onResponse);
  });
}

// --- Meta-governance helpers -------------------------------------------------
//
// Confidence tiers for inferred constraints:
//
// high   -> auto-apply as system-generated rule
// medium -> ask user clarification, then add as user-authorized rule
// low    -> discard but record in ledger
// -----------------------------------------------------------------------------

function classifyConfidenceTier(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return "low";
  if (s >= 0.78) return "high";
  if (s >= 0.5) return "medium";
  return "low";
}

/**
 * Legacy inferred constraints helper (now bypassed by HITL verification).
 */
function applyInferredConstraints({
  candidates,
  rules,
  ledger,
  socket,
  cycle,
}) {
  return [];
}

// --- Unresolved-conflict synthesis helper -----------------------------------

async function synthesizeUnresolvedConflicts({
  input,
  rules,
  stubbornViolations,
  plannedCycles,
}) {
  const system = `
You are the Governance Explainer for the cd\\ai governed dual-hemisphere architecture.

Your job:
- Summarize unresolved governance conflicts that the MCP could not fully reconcile
  before hitting its fail-safe cycle limit.
- Clearly flag that these conflicts MUST be handled by human experts.
- Use precise, neutral, compliance-aware language.
- Do NOT imply that the system is fully compliant or that risks are eliminated.
- Do NOT propose definitive legal interpretations; describe tensions and tradeoffs.

Return a short markdown section ONLY, suitable to append under a heading:
"## Unresolved Governance Conflicts (Requires Human Review)"

The section should:
- Open with 1-2 sentences explaining that the system reached a governed stop.
- Then provide 3-4 bullet points, each naming a concrete unresolved issue
  and what type of human reviewer (e.g., legal, clinical, data ethics) should address it.
`;

  const violationsSummary = stubbornViolations
    .map(
      (v) =>
        `Cycle ${v.cycle}: ${v.summary}${
          v.forbiddenHits && v.forbiddenHits.length
            ? ` | forbidden: ${v.forbiddenHits.join(", ")}`
            : ""
        }`
    )
    .join("\n");

  const user = `
User task:
${input}

High-level governance rules:
${
  (rules || [])
    .map((r, idx) => `${idx + 1}. ${(r.text || r).trim()}`)
    .join("\n") || "None provided."
}

Validator conflict history across ${plannedCycles} planned cycles:
${violationsSummary || "No recorded violations (this path should be rare)."}

Instructions:
- Focus only on tensions the system could not cleanly resolve.
- Make it obvious to a senior stakeholder that human governance is required.
- Avoid promising remediation; instead, frame items as "requires review."
`;

  const text = await callOpenAIChat({
    system,
    user,
    temperature: 0.2,
  });

  return (
    text ||
    "The MCP identified unresolved governance conflicts that require human review to reconcile regulatory, ethical, and operational expectations."
  );
}

// --- Core governed workflow (GIL-Lite + hard cap user mode) -----------------

async function runGovernedWorkflow(
  socket,
  {
    input,
    goal,
    maxCycles,
    governanceStrictness,
    perfMode,
    rules: injectedRules,
    baseLedger = [],
    governanceEnvelope,
    confidenceScore,
    requiresGovernedOutput = false,
  }
) {
  // Ledger reference for logging before normalization
  const ledgerRef = Array.isArray(baseLedger) ? baseLedger : [];

  // Per-run governance state holder (populated after classification/inference)
  const state = {
    activeRules: [],
    inferredRules: [],
    conflicts: [],
    defaultRules: [],
    explicitRules: [],
    generalRules: [],
    _finalOutputSent: false,
    _inFlight: false,
  };

  //
  // RULE STATE AUTO-CLEAR LOGIC
  //
  // Fully reset rules unless:
  //   (1) The user explicitly provided governance markers,
  //   (2) The message contains RULES-like structure,
  //   (3) Or the user explicitly said "keep the same rules".
  //
  const shouldPersistRules = (() => {
    const t = (input || "").toLowerCase();
    return (
      t.includes("apply the same rules") ||
      t.includes("keep previous rules") ||
      t.includes("continue using prior rules")
    );
  })();

  if (!shouldPersistRules) {
    // Completely clear ANY prior rules from previous runs
    state.activeRules = [];
    state.explicitRules = [];
    state.generalRules = [];
    state.inferredRules = [];
  }

  socket.emit("telemetry", {
    type: "governance-rules",
    rules: state.activeRules,
  });

  if (state._inFlight || runGovernedWorkflow._inFlight) {
    return;
  }
  state._inFlight = true;
  runGovernedWorkflow._inFlight = true;
  registerRuleClearHandler(socket, state);

  let ledger = Array.isArray(baseLedger)
    ? baseLedger.map((entry) => ({
        cycle: entry.cycle ?? 0,
        stage: entry.stage || "Governance",
        ...entry,
      }))
    : [];

  try {

  // === NEW: Early Rule Extraction (task-level) ==============================
  const stripRuleBlocks = (text) =>
    (text || "").replace(/rules\s*for\s*task[^:]*:\s*[\s\S]*?(?=\n\s*\n|$)/gi, "").trim();

  const earlyRuleResult = await extractRulesOnly(input);
  const taskLevelRules = {
    explicit: Array.isArray(earlyRuleResult.explicit) ? earlyRuleResult.explicit : [],
    general: Array.isArray(earlyRuleResult.general) ? earlyRuleResult.general : [],
    candidateInferred: Array.isArray(earlyRuleResult.candidateInferred)
      ? earlyRuleResult.candidateInferred
      : [],
  };
  const cleanedText = stripRuleBlocks(input);

  // === Deterministic Task Extraction (uses cleaned text) ====================
  const taskResult = await extractTasksOnly(cleanedText);
  const extractedTasks = Array.isArray(taskResult.tasks) ? taskResult.tasks : [];

  // Intent classification (after task + rule extraction)
  const intentResult = await classifyUserIntent(cleanedText);
  const intent = intentResult?.intent || "task";

  // --- Task fallback: if intent is task/mixed but extraction failed, treat full input as task ---
  if (
    (intentResult.intent === "task" || intentResult.intent === "mixed") &&
    (taskResult.parse_error || extractedTasks.length === 0)
  ) {
    const fallbackTask = cleanedText.trim();
    if (fallbackTask) {
      extractedTasks.splice(0, extractedTasks.length, fallbackTask);
      taskResult.parse_error = false;

      logGovernanceEvent(ledgerRef, {
        stage: "TaskExtraction",
        cycle: 0,
        summary:
          "Task extractor failed; classifier labeled message as task/mixed, so treated full input as a single task.",
        snippet: fallbackTask.slice(0, 260),
      });
    }
  }

  // Intent-aware routing: chat vs task vs rules vs mixed
  let tasksFromUser = extractedTasks.slice();
  let rulesFromUser = {
    explicit: taskLevelRules.explicit.slice(),
    general: taskLevelRules.general.slice(),
    candidateInferred: taskLevelRules.candidateInferred.slice(),
  };
  const ruleResult = earlyRuleResult;
  const extractedExplicitRules = taskLevelRules.explicit.slice();
  const extractedGeneralRules = taskLevelRules.general.slice();
  const extractedCandidateInferred = taskLevelRules.candidateInferred.slice();

  const strictnessLevel = computeStrictnessLevel({
    intent: intentResult,
    rules: [],
    taskLevelRules: [
      ...normalizeRuleArray(extractedExplicitRules),
      ...normalizeRuleArray(extractedGeneralRules),
      ...normalizeRuleArray(extractedCandidateInferred),
    ],
    tasks: tasksFromUser,
  });

  // --- Branch 1: pure conversational chat (no governed workflow) -----------
  if (intent === "chat") {
    const chatReply = await callOpenAIChat({
      system: `
You are the conversational interface for cd\\ai.

Behaviors:
- Talk to the user like ChatGPT.
- Do NOT invent or modify governance rules.
- Do NOT claim that governed validation has been run.
- If the user asks conceptual questions about governance, explain the architecture in plain language.
- If the user clearly asks you to "run a governed draft" or "govern this output", say:
  "Got it - please restate the concrete task you'd like governed and I'll run it through the MCP."
`,
      user: input,
      temperature: 0.4,
    });

    const chatText =
      chatReply ||
      "I'm here as the conversational layer; restate a concrete task if you want me to run the governed MCP.";

    ledgerRef.push({
      timestamp: new Date().toISOString(),
      stage: "ChatOnly",
      cycle: 0,
      summary: `Handled message as conversational chat (intent=${intent}).`,
      snippet: chatText.slice(0, 260),
    });

    socket.emit("telemetry", {
      type: "mcp-status",
      status: "Chat",
      detail: `Message handled as chat-only (intent=${intent}).`,
    });
    socket.emit("telemetry", { type: "ledger", entries: ledgerRef });
    emitFinalOutputOnce(socket, state, chatText, null);
    return;
  }

  // --- Branch 2: rules-only update (no immediate task execution) -----------
  if (intent === "rules") {
    if (ruleResult.parse_error) {
      ledgerRef.push({
        timestamp: new Date().toISOString(),
        stage: "RuleExtraction",
        cycle: 0,
        summary: "Rule extraction failed (invalid JSON); treating as no new rules.",
        snippet: ruleResult.error || ruleResult.raw_response || "",
      });

      socket.emit("telemetry", {
        type: "governance-response",
        text:
          "I had trouble parsing your rules as structured JSON. I did not change any active governance rules. " +
          "Please restate the rules more clearly or provide them as bullet points.",
      });
      socket.emit("telemetry", { type: "ledger", entries: ledgerRef });
      return;
    }

    rulesFromUser = {
      explicit: extractedExplicitRules,
      general: extractedGeneralRules,
      candidateInferred: extractedCandidateInferred,
    };

    // Commit new rules to state and show them in the UI, but do NOT run a governed task yet.
    if (extractedExplicitRules.length > 0 || extractedGeneralRules.length > 0) {
      commitRulesToState(state, extractedExplicitRules, extractedGeneralRules, []);
    } else {
      state.explicitRules = [];
      state.generalRules = [];
      state.inferredRules = [];
      state.activeRules = [];
    }

    ledgerRef.push({
      timestamp: new Date().toISOString(),
      stage: "RuleCommit",
      cycle: 0,
      summary: `Updated governance rules from user-only message (explicit=${state.explicitRules.length}, general=${state.generalRules.length}).`,
      snippet: "",
    });

    socket.emit("telemetry", {
      type: "governance-rules",
      rules: state.activeRules,
    });

    socket.emit("telemetry", {
      type: "governance-response",
      text:
        "Your governance rules have been updated. I will apply them the next time you ask me to run a governed task.",
    });
    socket.emit("telemetry", { type: "ledger", entries: ledgerRef });
    return;
  }

  // --- Branch 3: task or mixed (task + rules) ------------------------------
  // For "task" and "mixed" we will:
  // 1) Extract rules (if present),
  // 2) Extract tasks,
  // 3) Proceed into the governed MCP workflow.

  // Phase 1 — rules-only extraction (for "mixed" or tasks with inline constraints)
  if (ruleResult.parse_error) {
    // Do NOT fail the workflow; just log and continue with no additional rules from this message.
    ledgerRef.push({
      timestamp: new Date().toISOString(),
      stage: "RuleExtraction",
      cycle: 0,
      summary: "Rule extraction returned invalid JSON; proceeding without new rules from this message.",
      snippet: ruleResult.error || ruleResult.raw_response || "",
    });

    rulesFromUser = {
      explicit: [],
      general: [],
      candidateInferred: [],
    };
  } else {
    rulesFromUser = {
      explicit: extractedExplicitRules,
      general: extractedGeneralRules,
      candidateInferred: extractedCandidateInferred,
    };

    logGovernanceEvent(ledgerRef, {
      stage: "RuleExtraction",
      cycle: 0,
      summary: `Extracted rules from task message - explicit: ${rulesFromUser.explicit.length}; general: ${rulesFromUser.general.length}; inferred candidates: ${rulesFromUser.candidateInferred.length}`,
      snippet: ruleResult.raw_response ? JSON.stringify(ruleResult.raw_response).slice(0, 400) : "",
    });
  }

  // Phase 2 — tasks-only extraction
  let acceptedViaIntent = false;
  if (
    intent === "task" &&
    ((typeof intentResult.task === "string" && intentResult.task.trim()) || intentResult.task === null)
  ) {
    const primaryTask =
      (typeof intentResult.task === "string" && intentResult.task.trim()) || input.trim();
    if (primaryTask) {
      tasksFromUser = [primaryTask];
      acceptedViaIntent = true;
      logGovernanceEvent(ledgerRef, {
        stage: "TaskExtraction",
        cycle: 0,
        summary: "TaskExtraction – accepted primary task from classifier.",
        snippet: primaryTask.slice(0, 260),
      });
    }
  }

  if (!acceptedViaIntent) {
    if (taskResult.parse_error || !Array.isArray(extractedTasks) || extractedTasks.length === 0) {
      tasksFromUser = extractedTasks;
      logGovernanceEvent(ledgerRef, {
        stage: "TaskExtraction",
        cycle: 0,
        summary: "Task extraction ambiguous; proceeding with best-effort tasks without treating as failure.",
        snippet: taskResult.raw_response ? String(taskResult.raw_response).slice(0, 260) : "",
      });
    } else {
      tasksFromUser = extractedTasks;

      logGovernanceEvent(ledgerRef, {
        stage: "TaskExtraction",
        cycle: 0,
        summary: `Extracted ${tasksFromUser.length} task(s) from user input (intent=${intent}).`,
        snippet: taskResult.raw_response ? JSON.stringify(taskResult.raw_response).slice(0, 400) : "",
      });
    }
  }

  // Prepare inference context (prior tasks for continuity scoring)
  const priorTasks = tasksFromUser.slice(0, -1);

  // --- Phase 2b: Inference Confidence Model on candidate inferred rules -----
  const validatedInferredRules = [];
  if (/infer|inference|derive rule/i.test(input) || strictnessLevel >= 2) {
    for (const candidate of normalizeRuleArray(rulesFromUser.candidateInferred)) {
      const confidence = scoreInferredRule(candidate, { contextText: input, priorTasks });
      if (confidence >= 0.9) {
        validatedInferredRules.push({ text: candidate, origin: "system-inferred", confidence });
        logGovernanceEvent(ledgerRef, {
          stage: "RuleInference",
          cycle: 0,
          summary: `Inferred rule auto-accepted (${confidence.toFixed(2)}): ${candidate}`,
          snippet: candidate,
        });
      } else if (confidence >= 0.4) {
        logGovernanceEvent(ledgerRef, {
          stage: "RuleInference",
          cycle: 0,
          summary: `Inferred rule pending user confirmation (${confidence.toFixed(2)}): ${candidate}`,
          snippet: candidate,
        });
        const decision = await resolveMediumConfidenceRule(socket, candidate, confidence, 0, ledgerRef);
        if (decision?.decision === "clarify-needed") {
          socket.emit("telemetry", {
            type: "governance-response",
            text: "Please restate the inferred rule so I can include it.",
          });
          const clarified = await waitForUserClarification(socket, { cycle: 0 });
          const clarifiedText = (clarified || "").trim() || candidate;
          validatedInferredRules.push({ text: clarifiedText, origin: "user-confirmed-inferred", confidence });
          logGovernanceEvent(ledgerRef, {
            stage: "RuleInference",
            cycle: 0,
            summary: `Inferred rule clarified by user (${confidence.toFixed(2)}): ${clarifiedText}`,
            snippet: clarifiedText,
          });
        } else if (decision?.decision === "clarify") {
          validatedInferredRules.push({ text: decision.ruleText, origin: "user-confirmed-inferred", confidence });
          logGovernanceEvent(ledgerRef, {
            stage: "RuleInference",
            cycle: 0,
            summary: `Inferred rule user-clarified (${confidence.toFixed(2)}): ${decision.ruleText}`,
            snippet: decision.ruleText,
          });
        } else if (decision?.decision === "yes") {
          validatedInferredRules.push({ text: decision.ruleText, origin: "user-confirmed-inferred", confidence });
          logGovernanceEvent(ledgerRef, {
            stage: "RuleInference",
            cycle: 0,
            summary: `Inferred rule user-confirmed (${confidence.toFixed(2)}): ${decision.ruleText}`,
            snippet: decision.ruleText,
          });
        } else {
          logGovernanceEvent(ledgerRef, {
            stage: "RuleInference",
            cycle: 0,
            summary: `Inferred rule user-rejected (${confidence.toFixed(2)}): ${candidate}`,
            snippet: candidate,
          });
        }
      } else {
        logGovernanceEvent(ledgerRef, {
          stage: "RuleInference",
          cycle: 0,
          summary: `Inferred rule discarded (low confidence ${confidence.toFixed(2)}): ${candidate}`,
          snippet: candidate,
        });
      }
    }
  }

  // Phase 3 - commit rules for this run into state (elevation guarded)
  const elevateToGovernance =
    intent === "rules" || intent === "mixed" || strictnessLevel >= 3;
  if (elevateToGovernance && (extractedExplicitRules.length > 0 || extractedGeneralRules.length > 0)) {
    commitRulesToState(state, extractedExplicitRules, extractedGeneralRules, extractedCandidateInferred);
  } else {
    state.explicitRules = [];
    state.generalRules = [];
    state.inferredRules = [];
    state.activeRules = [];
  }
  logGovernanceEvent(ledgerRef, {
    stage: "RuleCommit",
    cycle: 0,
    summary: `Committed rules - explicit: ${state.explicitRules.length}, general: ${state.generalRules.length}, inferred: ${state.inferredRules.length}`,
    snippet: "",
  });

  // Override injected rules with committed state for this run
  injectedRules = state.activeRules.map((r) => ({ ...r }));

  // Phase 4 - enqueue tasks (first task drives this workflow invocation)
  await enqueueTasks(tasksFromUser, async (task) => task);
  input = tasksFromUser[0] || input;

  // Normalize knobs here so server.js can stay thin.
  const effectiveStrictness = normalizeStrictness(governanceStrictness);
  const mode = normalizePerfMode(perfMode);
  const strictnessEnabled = effectiveStrictness > 0;

  // GIL-Lite semantics:
  // - If maxCycles is null/undefined -> GIL-Lite controls cycles (up to HARD_MAX_CYCLES)
  // - If maxCycles is a number -> treat as a HARD user cap (1-10) that we never exceed
  let userCap = null;
  if (maxCycles !== null && maxCycles !== undefined) {
    const n = Number(maxCycles);
    if (Number.isFinite(n) && n > 0) {
      userCap = normalizeMaxCycles(n);
    }
  }

  const cycleCapEnabled = strictnessEnabled && userCap !== null;
  const gilActive = mode === "real" || (!cycleCapEnabled && userCap === null);

  // Reset panels (logs, ledger, rule statuses), but keep chat history.
  socket.emit("telemetry", { type: "reset" });

  // Signal GIL-Lite state to the UI.
  socket.emit("telemetry", {
    type: "gil-state",
    active: gilActive,
  });

  // Build rule objects with origin metadata (for UI colors).
  const hasInjectedRules = Array.isArray(injectedRules) && injectedRules.length > 0;
  const normalizedInjectedRules = hasInjectedRules
    ? injectedRules.map((r) =>
        typeof r === "string"
          ? { text: r, origin: "user", status: "pending" }
          : { ...r, text: r.text || "" }
      )
    : [];
  const goalDerivedRules = !hasInjectedRules
    ? parseRulesFromGoal(goal || "").map((t) => ({
        text: t,
        origin: "user",
        status: "pending",
      }))
    : [];
  const baseRules = hasInjectedRules ? normalizedInjectedRules : goalDerivedRules;
  state.explicitRules = baseRules.slice();
  state.activeRules = baseRules.slice();
  let rules = state.activeRules.slice();

  // Rule extraction via OpenAI (explicit + inferred) using full user submission
  const rawSubmissionText = typeof input === "string" ? input.trim() : "";

  // Explicit rule extraction: always run, strictness-dependent
  let explicitExtraction =
    (await extractExplicitRulesViaAPI(rawSubmissionText, { strictness: strictnessLevel })) || {
      explicit_rules: [],
      parse_error: false,
    };

  const explicitRulesFromAPI = (explicitExtraction.explicit_rules || []).map((r) => {
    if (r.type === "required_section_order") {
      return {
        text: `Include sections in order: ${(r.sections || []).join(" > ")}`,
        type: r.type,
        sections: r.sections || [],
        origin: "user",
        status: "pending",
      };
    }
    if (r.type === "forbidden_section") {
      return {
        text: `Do not generate section: ${r.name}`,
        type: r.type,
        name: r.name,
        origin: "user",
        status: "pending",
      };
    }
    if (r.type === "forbidden_feature") {
      return {
        text: `Forbid feature: ${r.name}`,
        type: r.type,
        name: r.name,
        origin: "user",
        status: "pending",
      };
    }
    return {
      text: r.rule || r.text || "",
      type: r.type || "requirement",
      origin: "user",
      status: "pending",
    };
  });
  state.explicitRules = explicitRulesFromAPI;
  rules = state.explicitRules.slice();
  state.activeRules = rules.slice();

  let inferenceResult = { inferred_rules: [], parse_error: false };
  if (explicitExtraction && Array.isArray(explicitExtraction.explicit_rules)) {
    try {
      inferenceResult =
        (await inferRulesViaAPI({
          taskText: rawSubmissionText,
          explicitRules: explicitRulesFromAPI,
          contextText: goal || "",
          strictness: strictnessLevel,
        })) || { inferred_rules: [], parse_error: false };
    } catch (err) {
      inferenceResult = { inferred_rules: [], errors: ["inference_engine_exception"], parse_error: true };
      if (ledger) {
        ledger.push({
          timestamp: new Date().toISOString(),
          stage: "RuleInference",
          cycle: 0,
          summary: "Inference engine failed gracefully",
          error: String(err),
        });
      }
    }
  }

  let candidateInferredRules = (inferenceResult.inferred_rules || []).map((r) => ({
    text: r.rule || "",
    confidence: r.confidence || 0,
    origin: "system",
  }));

  const rulesExist =
    (explicitExtraction.explicit_rules && explicitExtraction.explicit_rules.length > 0) ||
    (inferenceResult.inferred_rules && inferenceResult.inferred_rules.length > 0) ||
    extractedExplicitRules.length > 0 ||
    extractedGeneralRules.length > 0 ||
    validatedInferredRules.length > 0 ||
    taskLevelRules.explicit.length > 0 ||
    taskLevelRules.general.length > 0 ||
    (Array.isArray(injectedRules) && injectedRules.length > 0);

  const runGovernance = rulesExist;

  if (!runGovernance) {
    const taskText = extractedTasks[0] || rawSubmissionText;
    return runUngovernedTask(socket, taskText, perfMode, state);
  }

  const hardResetRules = state.explicitRules.length > 0;
  const pcgpRules = [];

  rules = [...state.explicitRules, ...pcgpRules];
  state.activeRules = rules.slice();
  const freshRulesThisTask =
    hasInjectedRules || state.explicitRules.length > 0 || pcgpRules.length > 0 || hardResetRules;
  requiresGovernedOutput =
    requiresGovernedOutput ||
    state.explicitRules.some((r) => r.type === "required_section_order");

  let envelope = null;
  if (/rule|rules|governance|section requirement/i.test(input.toLowerCase())) {
    envelope = parseGovernanceEnvelope(input);
  } else {
    envelope = { explicitRules: [], inferredRules: [], requiresGovernedOutput: false };
  }

  // Never treat task-language as governance sections
  if (extractedTasks.length > 0) {
    if (!envelope.structureSchema) {
      envelope.structureSchema = {};
    }
    envelope.structureSchema.requiredSections = [];
    envelope.requiresGovernedOutput = false;
  }

  if (inferenceResult.parse_error) {
    ledger.push({
      timestamp: new Date().toISOString(),
      stage: "RuleInference",
      cycle: 0,
      summary: "Inferred rule extraction parse error; model returned invalid JSON.",
      snippet: inferenceResult.error || inferenceResult.raw_response || "",
    });
  }
  if (candidateInferredRules.length === 0 && inferenceResult.raw_response) {
    ledger.push({
      timestamp: new Date().toISOString(),
      stage: "RuleInference",
      cycle: 0,
      summary: "No inferred rules returned by API.",
      snippet: inferenceResult.raw_response.slice(0, 400),
    });
  }

  if (hardResetRules) {
    ledger.push({
      timestamp: new Date().toISOString(),
      stage: "Governance",
      cycle: 0,
      summary: "Existing rules cleared due to explicit 'apply only these rules' instruction.",
      snippet: "",
    });
  }
  if (Array.isArray(envelope.metaWarnings) && envelope.metaWarnings.length) {
    envelope.metaWarnings.forEach((w) =>
      ledger.push({
        timestamp: new Date().toISOString(),
        stage: "MetaGovernance",
        cycle: 0,
        summary: `Contradictory constraints detected; using conservative interpretation. ${w}`,
        snippet: w,
      })
    );
  }

  // PCGP ledger entry
  ledger.push({
    timestamp: new Date().toISOString(),
    stage: "MCP - PCGP",
    cycle: 0,
    summary: `Governance Envelope initialized via API with ${state.explicitRules.length} explicit rules, ${candidateInferredRules.length} inferred candidates.`,
    snippet: `Sections: ${
      state.explicitRules
        .filter((r) => r.type === "required_section_order")
        .map((r) => (r.sections || []).join(", "))
        .join("; ") || "none"
    }`,
  });

  ledger.push({
    timestamp: new Date().toISOString(),
    stage: "RuleExtraction",
    cycle: 0,
    summary: `Explicit rules extracted via API: ${state.explicitRules.length}.`,
    snippet: JSON.stringify(explicitExtraction).slice(0, 400),
  });
  if (state.explicitRules.length === 0) {
    ledger.push({
      timestamp: new Date().toISOString(),
      stage: "RuleExtraction",
      cycle: 0,
      summary: "No explicit rules returned by API.",
      snippet: (explicitExtraction.raw_response || "").slice(0, 400),
    });
  }
  if (explicitExtraction.parse_error) {
    ledger.push({
      timestamp: new Date().toISOString(),
      stage: "RuleExtraction",
      cycle: 0,
      summary: "Explicit rule extraction parse error; model returned invalid JSON.",
      snippet: explicitExtraction.error || explicitExtraction.raw_response || "",
    });
  }

  // Verify any initial inferred candidates (HITL pipeline)
  rules = await verifyAndMaybeActivateInferredRules({
    candidates: candidateInferredRules,
    explicitRules: state.explicitRules,
    rules,
    ledger,
    socket,
    cycle: 0,
    input,
  });
  const runtimeTaskRules = [
    ...normalizeRuleArray(extractedExplicitRules),
    ...normalizeRuleArray(extractedGeneralRules),
  ];
  const runtimeTaskRuleObjects = runtimeTaskRules.map((text) => ({
    text,
    origin: "task-level",
    status: "pending",
  }));
  const userConfirmedInferred = validatedInferredRules
    .filter((r) => r.origin === "user-confirmed-inferred")
    .map((r) => ({ text: r.text, origin: "user-confirmed-inferred", status: "pending", confidence: r.confidence }));
  const systemInferred = validatedInferredRules
    .filter((r) => r.origin !== "user-confirmed-inferred")
    .map((r) => ({ text: r.text, origin: r.origin || "system-inferred", status: "pending", confidence: r.confidence }));
  const runtimeInferredRules =
    strictnessLevel >= 2 ? [...userConfirmedInferred, ...systemInferred] : [...userConfirmedInferred];
  rules = [...runtimeTaskRuleObjects, ...runtimeInferredRules, ...rules].map((r) =>
    typeof r === "string" ? { text: r, origin: "task-level", status: "pending" } : { ...r, text: r.text || "" }
  );
  state.activeRules = rules.slice();

  // Context drift detection before cycles (skip when explicit rules exist or new rules were supplied for this task)
  const shouldRunDrift =
    rules.length > 0 && !freshRulesThisTask && state.explicitRules.length === 0;

  if (shouldRunDrift) {
    const drift = await checkContextDrift(input, rules);
    if (drift) {
      const taskPreview = String(input || "").replace(/\s+/g, " ").slice(0, 160);
      const suggestionText =
        drift.driftDetected && (drift.rulesToSuggestClearing || []).length > 0
          ? `Suggested rules to clear: ${drift.rulesToSuggestClearing
              .map((i) => `Rule ${i + 1}`)
              .join(", ")}.`
          : "";
      const msg = drift.driftDetected
        ? `This task appears unrelated to your current governance rules (task: "${taskPreview}", similarity ${
            drift.similarity !== null && drift.similarity !== undefined
              ? drift.similarity.toFixed(2)
              : "n/a"
          }, threshold ${drift.threshold ?? 0.6}). Would you like to clear them? ${suggestionText}`
        : `Task and rules alignment OK (task: "${taskPreview}", similarity ${
            drift.similarity !== null && drift.similarity !== undefined
              ? drift.similarity.toFixed(2)
              : "n/a"
          }, threshold ${drift.threshold ?? 0.6}).`;

      ledger.push({
        timestamp: new Date().toISOString(),
        stage: "ContextDrift",
        cycle: 0,
        summary: msg,
        snippet: drift.explanation || "",
        trigger: "semantic",
        similarity: drift.similarity ?? null,
        threshold: drift.threshold ?? 0.6,
        rulesCount: rules.length,
      });

      if (drift.driftDetected) {
        socket.emit("telemetry", {
          type: "governance-response",
          text: msg,
          rulesToClear: drift.rulesToSuggestClearing || [],
          confidence: drift.confidence,
        });
      }
    }
  } else {
    ledger.push({
      timestamp: new Date().toISOString(),
      stage: "ContextDrift",
      cycle: 0,
      summary: "Context drift check skipped because rules were refreshed for this task or none exist.",
      snippet: "",
      trigger: "semantic",
      similarity: null,
      threshold: null,
      rulesCount: rules.length,
    });
  }

  // Track stubborn violations across cycles for unresolved-conflict surfacing
  const stubbornViolations = [];

  // Mode-specific knobs
  let plannedCycles = cycleCapEnabled && userCap != null ? userCap : HARD_MAX_CYCLES;
  let minCycles = 1;
  const cyclePlanReason = cycleCapEnabled ? "user-cap (strictness on)" : "failsafe (strictness off)";

  if (!cycleCapEnabled) {
    if (strictnessLevel <= 1) {
      plannedCycles = Math.min(plannedCycles, 1);
      minCycles = 1;
    } else if (strictnessLevel >= 3) {
      minCycles = Math.max(minCycles, strictnessLevel === 4 ? 3 : 2);
      plannedCycles = Math.max(plannedCycles, minCycles);
    }
  }

  if (mode === "real") {
    // REAL mode: require at least 2 cycles only when user did not set a 1-cycle cap.
    if (cycleCapEnabled && userCap === 1) {
      minCycles = 1;
    } else {
      minCycles = Math.min(2, plannedCycles);
    }
  } else if (mode === "fast") {
    minCycles = 1;
  } else if (mode === "turbo") {
    // Turbo: single-pass approximation
    socket.emit("telemetry", {
      type: "gil-state",
      active: gilActive,
    });
    return runTurboWorkflow(socket, {
      input,
      goal,
      rules,
      governanceStrictness: effectiveStrictness,
      ledger,
      requiresGovernedOutput,
      state,
    });
  }

  // Tell UI how many cycles we plan (for animation only)
  socket.emit("telemetry", {
    type: "cycle-plan",
    plannedCycles,
    reason: cyclePlanReason,
  });

  ledger.push({
    timestamp: new Date().toISOString(),
    stage: "CyclePlan",
    cycle: 0,
    summary: `Planned cycles set to ${plannedCycles} via ${cyclePlanReason}.`,
    snippet: "",
  });

  // Initialize rules panel
  socket.emit("telemetry", {
    type: "governance-rules",
    rules,
  });

  socket.emit("telemetry", {
    type: "mcp-status",
    status: "Starting",
    detail: `Initializing governed workflow in ${mode.toUpperCase()} mode...`,
  });

  // --- Task Agent initial draft ---------------------------------------------

  const taskDraft = await taskAgentPass({
    input,
    rules,
  });

  let currentText = taskDraft || `Initial draft based on: "${input}"`;

  ledger.push({
    timestamp: new Date().toISOString(),
    stage: "TaskAgent",
    cycle: 0,
    summary:
      "Initial draft generated by Task Agent (format inferred from task).",
    snippet: currentText.slice(0, 260),
  });

  socket.emit("telemetry", {
    type: "hemisphere-log",
    hemisphere: "A",
    message: "Task Agent produced the first draft.",
  });

  // Meta-governance state
  let validation = initialValidationState();
  let converged = false;
  let clarificationCount = 0;
  let cyclesRun = 0;
  let hitRunaway = false;
  const clarifications = [];
  let previousWarningsSignature = null;
  let noNewWarningsStreak = 0;
  let previousRiskTokens = new Set();

  // --- Dual-hemisphere cycles -----------------------------------------------
  const effectiveMax = plannedCycles;
  for (let cycle = 1; cycle <= effectiveMax; cycle++) {
    cyclesRun = cycle;
    socket.emit("telemetry", { type: "cycle-update", cycle });
    socket.emit("telemetry", {
      type: "governance-rules-progress",
      cycle,
    });

    if (cycle === 1 && requiresGovernedOutput) {
      currentText = applyCycleOneFilters(currentText);
    }

    // ---- Analytical --------------------------------------------------------
    socket.emit("telemetry", {
      type: "mcp-status",
      status: "Analytical Pass",
      detail: `Cycle ${cycle}: analytical hemisphere enforcing governance constraints.`,
    });

    const analyticalResult = await analyticalPass(currentText, {
      input,
      rules,
      governanceStrictness: effectiveStrictness,
      requiresGovernedOutput,
    });

    currentText = analyticalResult.rewrittenText;
    validation = analyticalResult.validation;

    // Meta-governance: handle inferred constraints via HITL pipeline
    rules = await verifyAndMaybeActivateInferredRules({
      candidates: analyticalResult.inferredConstraints,
      explicitRules: state.explicitRules,
      rules,
      ledger,
      socket,
      cycle,
      input,
    });
    state.activeRules = rules.slice();

    ledger.push({
      timestamp: new Date().toISOString(),
      stage: "Analytical",
      cycle,
      summary: analyticalResult.deltaSummary,
      snippet: currentText.slice(0, 260),
    });

    socket.emit("telemetry", {
      type: "hemisphere-log",
      hemisphere: "A",
      message: `Cycle ${cycle}: ${analyticalResult.deltaSummary}`,
    });

    // ---- Moderator (pre-creative) -----------------------------------------
    socket.emit("telemetry", {
      type: "mcp-status",
      status: "Moderator",
      detail: `Cycle ${cycle}: moderator tightening the creative prompt to prevent reintroducing violations and manage inferred constraints.`,
    });

    const moderatorResult = await moderatorPass(currentText, {
      input,
      rules,
      governanceStrictness: effectiveStrictness,
      analyticalSummary: analyticalResult.deltaSummary,
      directives: analyticalResult.directives,
      validation,
      mediumCandidates: [],
    });

    ledger.push({
      timestamp: new Date().toISOString(),
      stage: "Moderator",
      cycle,
      summary: moderatorResult.moderatorSummary,
      snippet: currentText.slice(0, 260),
    });

    socket.emit("telemetry", {
      type: "moderator-log",
      message: `Cycle ${cycle} (pre-creative): ${
        moderatorResult.moderatorSummary
      } ${
        typeof moderatorResult.confidence === "number"
          ? `(confidence ${moderatorResult.confidence.toFixed(2)})`
          : ""
      }`.trim(),
    });

    // --- Optional: user clarification loop ---------------------------------
    let userFeedback = null;

    if (
      moderatorResult.needsUserClarification &&
      clarificationCount < 2 &&
      mode !== "turbo"
    ) {
      clarificationCount += 1;

      const question =
        moderatorResult.userQuestion ||
        "The MCP needs a brief clarification to choose between competing interpretations of your request. Please restate what you want in 1-2 sentences.";
      clarifications.push({
        cycle,
        status: "requested",
        question: question.slice(0, 500),
      });

      socket.emit("telemetry", {
        type: "clarification-request",
        question,
        confidence: moderatorResult.confidence ?? null,
        cycle,
      });

      ledger.push({
        timestamp: new Date().toISOString(),
        stage: "ClarificationRequest",
        cycle,
        summary: `Moderator requested user clarification: "${question.slice(
          0,
          200
        )}"`,
        snippet: currentText.slice(0, 200),
      });

      userFeedback = await waitForUserClarification(socket, { cycle });

      if (userFeedback) {
        clarifications.push({
          cycle,
          status: "answered",
          answer: userFeedback.slice(0, 500),
        });
        ledger.push({
          timestamp: new Date().toISOString(),
          stage: "UserFeedback",
          cycle,
          summary:
            "User clarification received and will be incorporated as a user-authorized constraint.",
          snippet: userFeedback.slice(0, 200),
        });

        const clarifiedRule = {
          text: userFeedback,
          origin: "user-clarified",
          status: "pending",
        };
        rules.push(clarifiedRule);

        socket.emit("telemetry", {
          type: "governance-rules",
          rules,
        });

        ledger.push({
          timestamp: new Date().toISOString(),
          stage: "MetaGovernance",
          cycle,
          summary:
            "User clarification converted into a user-authorized governance rule and will be enforced from the next cycle.",
          snippet: userFeedback.slice(0, 260),
        });

        socket.emit("telemetry", {
          type: "moderator-log",
          message:
            "Cycle " +
            cycle +
            ": user clarification received and injected into the MCP prompt as a new rule.",
        });
      } else {
        ledger.push({
          timestamp: new Date().toISOString(),
          stage: "ClarificationTimeout",
          cycle,
          summary:
            "No user clarification received within the time window; MCP continued using existing assumptions.",
          snippet: currentText.slice(0, 200),
        });

        socket.emit("telemetry", {
          type: "moderator-log",
          message:
            "Cycle " +
            cycle +
            ": no user clarification received in time; continued with existing interpretation.",
        });
        clarifications.push({
          cycle,
          status: "timeout",
        });
      }
    }

    // ---- Creative ----------------------------------------------------------
    socket.emit("telemetry", {
      type: "mcp-status",
      status: "Creative Pass",
      detail:
        "Creative hemisphere refining tone and readability within moderated constraints.",
    });

    const creativeResult = await creativePass(currentText, {
      input,
      rules,
      governanceStrictness: effectiveStrictness,
      moderatedPrompt: moderatorResult.moderatedPrompt,
      userFeedback,
    });

    currentText = creativeResult.rewrittenText;

    ledger.push({
      timestamp: new Date().toISOString(),
      stage: "Creative",
      cycle,
      summary: creativeResult.deltaSummary,
      snippet: currentText.slice(0, 260),
    });

    socket.emit("telemetry", {
      type: "hemisphere-log",
      hemisphere: "B",
      message: `Cycle ${cycle}: ${creativeResult.deltaSummary}`,
    });

    // ---- Moderator (post-creative) ----------------------------------------
    socket.emit("telemetry", {
      type: "mcp-status",
      status: "Moderator",
      detail: `Cycle ${cycle}: moderator reviewing creative output before handing back to Analytical.`,
    });

    const postCreativeModeratorResult = await moderatorPass(currentText, {
      input,
      rules,
      governanceStrictness: effectiveStrictness,
      analyticalSummary: creativeResult.deltaSummary,
      directives: analyticalResult.directives,
      validation,
      mediumCandidates: [],
    });

    ledger.push({
      timestamp: new Date().toISOString(),
      stage: "Moderator",
      cycle,
      summary: postCreativeModeratorResult.moderatorSummary,
      snippet: currentText.slice(0, 260),
    });

    socket.emit("telemetry", {
      type: "moderator-log",
      message: `Cycle ${cycle} (post-creative): ${
        postCreativeModeratorResult.moderatorSummary
      } ${
        typeof postCreativeModeratorResult.confidence === "number"
          ? `(confidence ${postCreativeModeratorResult.confidence.toFixed(
              2
            )})`
          : ""
      }`.trim(),
    });

    // ---- Validator ---------------------------------------------------------
    let postCreativeValidation = {
      ...initialValidationState(),
      isCompliant: true,
      hardViolationCount: 0,
      detailedHits: [],
    };
    if (requiresGovernedOutput) {
      postCreativeValidation = await validatorPass(currentText, {
        input,
        rules,
        governanceStrictness: effectiveStrictness,
        cycle,
        requiresGovernedOutput,
      });
    }

    validation = postCreativeValidation;

    const summary = validationSummary(validation);

    ledger.push({
      timestamp: new Date().toISOString(),
      stage: "Validator",
      cycle,
      summary,
      snippet: currentText.slice(0, 260),
    });

    if (!validation.isCompliant) {
      const hardViolationCount =
        validation.hardViolationCount ??
        (validation.detailedHits || []).filter((v) => v.severity === "hard").length;
      const structuralFailure = validation.artifactsOk === false;
      if (hardViolationCount > 0 || structuralFailure) {
        stubbornViolations.push({
          cycle,
          summary,
          hardViolationCount,
          structuralFailure,
          forbiddenHits: validation.forbiddenHits || [],
          hits: validation.detailedHits || [],
        });
      }
    }

    // --- GIL Lite state updates ---------------------------------------------
    const hardCount =
      validation.hardViolationCount ??
      (validation.detailedHits || []).filter((v) => v.severity === "hard").length;
    const warningHits = (validation.detailedHits || []).filter(
      (v) => v.severity === "warning"
    );
    const warningSignature = JSON.stringify(
      warningHits.map((w) => `${w.section || "global"}|${w.snippet || ""}`)
    );
    const warningsChanged =
      previousWarningsSignature !== null &&
      warningSignature !== previousWarningsSignature;
    if (hardCount === 0) {
      if (previousWarningsSignature === null) {
        noNewWarningsStreak = 1;
      } else if (!warningsChanged) {
        noNewWarningsStreak += 1;
      } else {
        noNewWarningsStreak = 1;
      }
    } else {
      noNewWarningsStreak = 0;
    }
    previousWarningsSignature = warningSignature;

    const currentRiskTokens = new Set(validation.riskyTokens || []);
    const introducedRiskTokens = [...currentRiskTokens].filter(
      (t) => !previousRiskTokens.has(t)
    );
    previousRiskTokens = currentRiskTokens;
    const userOverridePresent = rules.some(
      (r) => r.origin === "user-clarified"
    );

    const canConverge =
      hardCount === 0 &&
      noNewWarningsStreak >= 2 &&
      introducedRiskTokens.length === 0 &&
      cycle >= minCycles;

    const runaway =
      !userOverridePresent &&
      stubbornViolations.length > 0 &&
      (stubbornViolations.length >= 5 || cycle === HARD_MAX_CYCLES);

    if (canConverge) {
      converged = true;
      break;
    }

    if (runaway) {
      hitRunaway = true;
      break;
    }
  }

  // --- Finalization + Unresolved Governance Conflicts surfacing -------------

  let finalText = currentText;
  let narrative = null;

  if (requiresGovernedOutput && state.activeRules.length > 0) {
    finalText = coerceToCanonicalStructure(currentText);

    if ((envelope.contradictions || []).length) {
      envelope.contradictions.forEach((c) =>
        stubbornViolations.push({
          cycle: cyclesRun,
          summary: c.text || "Governance contradictions detected.",
          hardViolationCount: 0,
          structuralFailure: false,
          forbiddenHits: [],
          hits: [],
        })
      );
    }

    const unresolvedConflictsPresent =
      stubbornViolations.some(
        (v) =>
          (v.hardViolationCount || 0) > 0 ||
          v.structuralFailure ||
          (v.forbiddenHits || []).length > 0
      ) || (envelope.contradictions || []).length > 0;

    if (!converged && unresolvedConflictsPresent) {
      const unresolvedSection = await synthesizeUnresolvedConflicts({
        input,
        rules,
        stubbornViolations,
        plannedCycles,
      });

      finalText =
        currentText +
        "\n\n## Unresolved Governance Conflicts (Requires Human Review)\n" +
        unresolvedSection;

      ledger.push({
        timestamp: new Date().toISOString(),
        stage: "UnresolvedConflicts",
        cycle: plannedCycles,
        summary:
          "Engine reached fail-safe stop with unresolved governance tensions; surfaced them explicitly for human review instead of silently reconciling.",
        snippet: unresolvedSection.slice(0, 260),
      });
    }

    // Stamp final rule statuses for UI summary
    const finalRuleStatus = validation.isCompliant ? "passed" : "failed";
    const finalizedRules = rules.map((r) => {
      // Keep explicit clarified status if origin indicates user clarification
      const clarified =
        r.origin === "user-clarified" || r.status === "clarified";
      return {
        ...r,
        status: clarified ? "clarified" : finalRuleStatus,
      };
    });

    // Build narrative only when governed output is explicitly required and run has concluded
    narrative = buildNarrativeReport({
      input,
      goal,
      mode,
      converged,
      validation,
      plannedCycles,
      cyclesRun,
      stubbornViolations,
      clarifications,
      rules: finalizedRules,
      hitRunaway,
    });

    socket.emit("telemetry", {
      type: "governance-rules-final",
      rules: finalizedRules,
    });
    socket.emit("telemetry", {
      type: "mcp-status",
      status: "Finalized",
      detail: converged
        ? "Governed output locked after dual-hemisphere convergence and meta-governance decisions."
        : "Locked after max cycles (fail-safe stop with surfaced governance conflicts where applicable).",
    });
  } else {
    validation = { ...initialValidationState(), isCompliant: true, overall_score: 1 };
    socket.emit("telemetry", {
      type: "mcp-status",
      status: "Finalized",
      detail: "Finalized with raw cycles output (governed structure not requested).",
    });
  }

  socket.emit("telemetry", { type: "ledger", entries: ledger });
  emitFinalOutputOnce(socket, state, finalText, narrative);
  } finally {
    state._inFlight = false;
    runGovernedWorkflow._inFlight = false;
  }
}

// --- Turbo workflow (ultra-fast, approximate governance) --------------------

async function runTurboWorkflow(
  socket,
  { input, goal, rules, governanceStrictness, ledger, requiresGovernedOutput = false, state = null }
) {
  socket.emit("telemetry", {
    type: "cycle-plan",
    plannedCycles: 2,
  });

  socket.emit("telemetry", {
    type: "governance-rules",
    rules,
  });

  socket.emit("telemetry", {
    type: "mcp-status",
    status: "Starting",
    detail:
      "Turbo mode: single governed pass with approximate validation for demonstration speed.",
  });

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
${rules.map((r) => r.text || r).join("\n") || "None provided."}
    `,
    temperature: 0.5,
  });

  const text =
    combined || `Draft (turbo mode) based on: "${input}"`;

  const now = new Date().toISOString();
  ledger.push({
    timestamp: now,
    stage: "Turbo",
    cycle: 1,
    summary:
      "Turbo mode executed a single combined governed pass (Task + Analytical + Creative). Meta-governance behavior is approximated only.",
    snippet: text.slice(0, 260),
  });

  socket.emit("telemetry", {
    type: "hemisphere-log",
    hemisphere: "A",
    message:
      "Turbo mode: analytical behavior approximated in a single combined pass.",
  });
  socket.emit("telemetry", {
    type: "hemisphere-log",
    hemisphere: "B",
    message:
      "Turbo mode: creative polish applied once under approximate constraints.",
  });
  socket.emit("telemetry", {
    type: "moderator-log",
    message:
      "Turbo mode: moderator and meta-governance behavior simulated for demo; no user clarifications requested in this mode.",
  });

  const turboFinalRules = rules.map((r) => ({
    ...r,
    status: r.origin === "user-clarified" ? "clarified" : "passed",
  }));

  if (requiresGovernedOutput && turboFinalRules.length > 0) {
    socket.emit("telemetry", { type: "governance-rules-final", rules: turboFinalRules });
  }
  socket.emit("telemetry", {
    type: "mcp-status",
    status: "Finalized",
    detail:
      "Turbo mode completed: governed behavior approximated in a single pass for speed.",
  });

  socket.emit("telemetry", { type: "ledger", entries: ledger });
  socket.emit("telemetry", {
    type: "governance-rules",
    rules,
  });

  const narrative =
    requiresGovernedOutput && turboFinalRules.length > 0
      ? buildNarrativeReport({
          input,
          goal,
          mode: "turbo",
          converged: true,
          validation: { ...initialValidationState(), isCompliant: true },
          plannedCycles: 2,
          cyclesRun: 1,
          stubbornViolations: [],
          clarifications: [],
          rules: turboFinalRules,
          hitRunaway: false,
        })
      : null;

  emitFinalOutputOnce(socket, state, text, narrative);
}

// --- Passes: Task Agent, Analytical, Moderator, Creative, Validator ----------

async function taskAgentPass({ input, rules }) {
  const system = `
You are the Task Agent in a governed dual-hemisphere AI system (cd\\ai).

Your responsibilities:
- Produce an initial neutral draft based on the user task.
- Infer the most natural output format from the task (e.g., email, memo, bullets),
  and preserve that structure (greetings, subject lines, paragraphs, bullets)
  unless governance rules explicitly require a different structure.
- Do not over-optimize for governance; this is a baseline for refinement by
  the Analytical and Creative hemispheres.
- Keep the style business-formal and concise by default.
  `;

  const user = `
User task:
${input}

High-level governance hints (do NOT treat as exact instructions):
${rules.map((r) => r.text || r).join("\n") || "None provided."}

If the user task clearly implies a format (e.g., "draft an email", "create 4 bullet points"),
honor that format in your draft, as long as it does not directly conflict with the governance hints.
  `;

  const draft = await callOpenAIChat({
    system,
    user,
    temperature: 0.5,
  });

  return draft;
}

async function analyticalPass(
  currentText,
  { input, rules, governanceStrictness, requiresGovernedOutput = false }
) {
  const canonicalGuidance = requiresGovernedOutput
    ? "Enforce the canonical four-section schema (Root Cause, Remediation, Governance Enhancement, Leadership Summary) when not present"
    : "Do not impose governed sections; preserve the task's natural structure unless explicitly requested";

  const system = `
You are the ANALYTICAL hemisphere in the cd\\ai governed architecture.

Your responsibilities:
- Enforce governance constraints strictly,
- Make minimal necessary edits to the draft,
- ${canonicalGuidance}
- Strip commitments/guarantees/deterministic numerics (will/commit/ensure/guarantee, %, confidence claims),
- Remove role/department/team/committee nouns and regulatory-adjacent phrasing; replace with neutral alternatives,
- Use hedged modals ("aim to", "plan to", "intend to", "designed to") and qualitative statements ("approximate", "subject to validation") instead of deterministic promises,
- Preserve the user's inferred structure and format whenever possible
  (e.g., if it already looks like an email, keep greetings, subject line, closing),
- Detect any *implicit* constraints that the user or governance hints strongly imply
  (e.g., "avoid aggressive tone", "must remain under a certain length", "do not imply non-compliance"),
- Report clearly what changed and why.

You must return JSON ONLY with the following structure:
{
  "rewrittenText": "string",
  "directives": [
    {
      "area": "length | forbidden_terms | structure | tone | artifacts | reliability_language | other",
      "strength": 0.0-1.0,
      "instruction": "short plain-language directive"
    }
  ],
  "validation": {
    "forbiddenHits": ["word1", "word2"],
    "wordCountOk": true/false,
    "artifactsOk": true/false,
    "impliedReliabilityOk": true/false
  },
  "inferredConstraints": [
    {
      "text": "a potential new governance constraint, inferred from the task or hints",
      "confidence": 0.0-1.0
    }
  ],
  "deltaSummary": "1-2 sentence explanation of what you changed THIS CYCLE in clear business language."
}
  `;

  const user = `
Task:
${input}

Governance rules (treat as hard constraints):
${rules.map((r) => r.text || r).join("\n")}

Current draft (preserve its overall format if possible):
${currentText}

Strictness coefficient: ${governanceStrictness.toFixed(2)}

Structural guidance: ${
    requiresGovernedOutput
      ? "If governed sections are missing, add them."
      : "Do NOT add governed section headings; keep the task's natural structure."
  }

Be conservative: when unsure, prefer to tighten language rather than relax it.
Do NOT flatten formatting unless the rules clearly require a structural change.
If you suggest inferredConstraints, they MUST be grounded in the task or hints and you must assign realistic confidence scores.
  `;

  const raw = await callOpenAIChat({
    system,
    user,
    temperature: 0.2,
    response_format: "json",
  });

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      rewrittenText: currentText,
      directives: [],
      validation: initialValidationState(),
      inferredConstraints: [],
      deltaSummary:
        "Analytical hemisphere encountered a parsing issue and preserved the previous draft.",
    };
  }

  const validation = {
    ...initialValidationState(),
    ...(parsed.validation || {}),
  };

  return {
    rewrittenText: parsed.rewrittenText || currentText,
    directives: Array.isArray(parsed.directives) ? parsed.directives : [],
    inferredConstraints: Array.isArray(parsed.inferredConstraints)
      ? parsed.inferredConstraints
      : [],
    validation,
    deltaSummary:
      parsed.deltaSummary ||
      "Analytical hemisphere updated structure and governance alignment.",
  };
}

async function moderatorPass(
  currentText,
  {
    input,
    rules,
    governanceStrictness,
    analyticalSummary,
    directives,
    validation,
    mediumCandidates,
  }
) {
  const system = `
You are the MODERATOR between the Analytical and Creative hemispheres in cd\\ai.

Your role:
- Rewrite the prompt that will be given to the Creative hemisphere,
- So that the Creative hemisphere expands and polishes the text WITHOUT reintroducing governance violations,
- Preserve the existing inferred output format (email, memo, bullets, etc.) unless rules require otherwise,
- Integrate and respect any *existing* governance rules, including user-original and system-inferred ones,
- Decide whether user clarification is needed when confidence is low or the rules/inputs are ambiguous.
- Hard-stop on commitments, roles/teams, regulators, percentages/formulas, deterministic verbs, and literal "guarantee" even as an example.
- Leadership tone must be reassuring; analytical content must stay crisp and hedged.

You must return JSON ONLY with:
{
  "moderatedPrompt": "prompt text the Creative hemisphere should follow",
  "moderatorSummary": "1-2 sentence summary of how you constrained the Creative behavior",
  "confidence": 0.0-1.0,
  "needsUserClarification": true/false,
  "userQuestion": "short, plain-language question to ask the user when clarification is needed, or null if not needed"
}
  `;

  const user = `
User task:
${input}

Current governance rules:
${rules
  .map(
    (r, idx) =>
      `${idx + 1}. [origin=${r.origin || "user"}] ${(r.text || r).trim()}`
  )
  .join("\n")}

Current draft:
${currentText}

Analytical summary this cycle:
${analyticalSummary}

Analytical directives:
${JSON.stringify(directives || [], null, 2)}

Validator state:
${JSON.stringify(validation || {}, null, 2)}

Medium-confidence inferred constraints from the Analytical hemisphere this cycle:
${
  (mediumCandidates || [])
    .map(
      (c, idx) =>
        `${idx + 1}. (confidence ${c.confidence.toFixed(2)}): ${c.text}`
    )
    .join("\n") || "None."
}

Strictness coefficient: ${governanceStrictness.toFixed(2)}

Guidance:
- If you are reasonably confident (e.g., confidence >= 0.7) that you understand
  the user's intent and the governance rules are unambiguous, set
  "needsUserClarification": false.
- If there are medium-confidence inferred constraints AND you are not confident
  that they should be auto-applied, set "needsUserClarification": true and craft
  a SINGLE clear question that a senior business stakeholder could answer in
  1-2 sentences. The question should summarize the most important uncertainty.
  `;

  const raw = await callOpenAIChat({
    system,
    user,
    temperature: 0.25,
    response_format: "json",
  });

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      moderatedPrompt:
        "You are the Creative hemisphere. Improve readability and flow without relaxing any governance constraints or reintroducing forbidden terms. Keep the length and structure close to the current draft.",
      moderatorSummary:
        "Moderator fallback: used a default conservative prompt to keep Creative changes bounded.",
      confidence: 0.6,
      needsUserClarification: false,
      userQuestion: null,
    };
  }

  return {
    moderatedPrompt:
      parsed.moderatedPrompt ||
      "You are the Creative hemisphere. Improve readability and flow without relaxing any governance constraints or reintroducing forbidden terms.",
    moderatorSummary:
      parsed.moderatorSummary ||
      "Moderator constrained Creative behavior to focus on clarity and tone without weakening governance alignment.",
    confidence:
      typeof parsed.confidence === "number" ? parsed.confidence : 0.7,
    needsUserClarification: !!parsed.needsUserClarification,
    userQuestion: parsed.userQuestion || null,
  };
}

async function creativePass(
  currentText,
  { input, rules, governanceStrictness, moderatedPrompt, userFeedback }
) {
  const system = `
You are the CREATIVE hemisphere in the cd\\ai architecture.
You MUST obey the moderatedPrompt you receive.

Your job:
- Improve clarity, narrative flow, and executive readability,
- Preserve the existing inferred format (email, memo, bullets, etc.) unless
  moderatedPrompt explicitly instructs otherwise,
- Do NOT reintroduce any governance violations or forbidden language,
- Keep the length reasonably close unless moderatedPrompt explicitly says otherwise.

Return JSON ONLY with:
{
  "rewrittenText": "string",
  "deltaSummary": "1-2 sentence summary of how you improved tone/readability this cycle"
}
  `;

  const user = `
moderatedPrompt (FOLLOW THIS CAREFULLY):
${moderatedPrompt}

User task:
${input}

Current governance rules (must remain satisfied):
${rules.map((r) => r.text || r).join("\n")}

Current draft to refine (preserve structure unless instructed otherwise):
${currentText}

User clarification (if any; treat as authoritative when present):
${userFeedback || "None provided."}

Strictness coefficient: ${governanceStrictness.toFixed(2)}
  `;

  const raw = await callOpenAIChat({
    system,
    user,
    temperature: 0.4,
    response_format: "json",
  });

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      rewrittenText: currentText,
      deltaSummary:
        "Creative hemisphere encountered a parsing issue and preserved the prior draft.",
    };
  }

  return {
    rewrittenText: parsed.rewrittenText || currentText,
    deltaSummary:
      parsed.deltaSummary ||
      "Creative hemisphere refined clarity, flow, and tone while respecting governance constraints.",
  };
}

async function validatorPass(
  text,
  { input, rules, governanceStrictness, cycle, requiresGovernedOutput = false }
) {
  if (requiresGovernedOutput !== true) {
    return {
      ...initialValidationState(),
      isCompliant: true,
      overall_score: 1,
      hardViolationCount: 0,
      detailedHits: [],
    };
  }
  const evaluation = detectGovernanceViolations(text, { cycle });
  const base = initialValidationState();
  const merged = { ...base, ...evaluation };
  merged.isCompliant =
    merged.artifactsOk &&
    merged.impliedReliabilityOk &&
    (merged.forbiddenHits || []).length === 0 &&
    (merged.hardViolationCount || 0) === 0;
  merged.overall_score =
    typeof evaluation.overall_score === "number"
      ? evaluation.overall_score
      : merged.precisionScore;

  try {
    if (!merged.isCompliant) {
      merged.narrative = await generateGovernanceNarrative({
        summary: validationSummary(merged),
        explanation: JSON.stringify(
          (merged.detailedHits || []).slice(0, 5),
          null,
          2
        ),
        confidence: merged.overall_score,
      });
    }
  } catch (err) {
    merged.narrative = null;
  }

  return merged;
}

// --- Narrative Layer (post-run, compliance-safe) -----------------------------
function buildNarrativeReport({
  input,
  goal,
  mode,
  converged,
  validation,
  plannedCycles,
  cyclesRun,
  stubbornViolations,
  clarifications,
  rules,
  hitRunaway,
}) {
  const compliant = !!validation?.isCompliant;
  const violationsCount = Array.isArray(stubbornViolations)
    ? stubbornViolations.length
    : 0;
  const requestedClarifications = (clarifications || []).filter(
    (c) => c.status === "requested"
  ).length;
  const answeredClarifications = (clarifications || []).filter(
    (c) => c.status === "answered"
  ).length;
  const timeouts = (clarifications || []).filter(
    (c) => c.status === "timeout"
  ).length;
  const inferredCount = (rules || []).filter((r) => r.origin === "system").length;
  const clarifiedCount = (rules || []).filter(
    (r) => r.origin === "user-clarified" || r.status === "clarified"
  ).length;
  const failedRules = (rules || []).filter((r) => r.status === "failed");

  const outcomePhrase = converged
    ? "Convergence achieved."
    : hitRunaway
    ? "Run halted by fail-safe protections before convergence."
    : "Output locked without convergence after reaching the configured cap.";

  const governancePhrase = compliant
    ? "Governance checks passed."
    : violationsCount > 0 || failedRules.length > 0
    ? "Governance issues remain; review flagged rules and conflicts."
    : "Governance alignment uncertain; review before acting.";

  const warningsPhrase =
    violationsCount > 0
      ? `Detected ${violationsCount} unresolved governance conflict(s).`
      : "";

  const summarySentences = [
    `Governed run executed in ${String(mode || "real").toUpperCase()} mode over ${cyclesRun || 0} of ${plannedCycles} planned cycle(s).`,
    outcomePhrase,
    governancePhrase,
    warningsPhrase,
  ]
    .filter(Boolean)
    .slice(0, 4);

  const summaryText = summarySentences.join(" ");

  const outcomeSummary = `Completed governed pass with final output delivered; ${converged ? "stopped after convergence" : "stopped at a safety limit"}.`;
  const governanceAlignment = compliant
    ? "Validator marked draft as compliant with provided governance rules."
    : "Validator signaled outstanding governance risks; consult rule failures/conflicts before execution.";
  const cycleBehavior = `Planned cycles: ${plannedCycles}. Executed cycles: ${cyclesRun}. ${hitRunaway ? "Fail-safe triggered (runaway/limit reached)." : converged ? "Converged within planned window." : "Stopped at cap without convergence."}`;
  const clarificationSummary =
    requestedClarifications + answeredClarifications + timeouts > 0
      ? `Requested ${requestedClarifications}, answered ${answeredClarifications}, timeouts ${timeouts}.`
      : "No clarifications were requested.";
  const inferredSummary =
    inferredCount > 0
      ? `${inferredCount} system-inferred constraint(s) enforced; ${clarifiedCount} user-clarified rule(s).`
      : `${clarifiedCount} user-clarified rule(s); no additional inferred constraints applied.`;
  const confidenceSummary = compliant && converged
    ? "High confidence based on validator compliance and stable stop condition."
    : "Moderate confidence; treat output as provisional until governance issues are cleared.";
  const ruleFailureSummary =
    failedRules.length > 0
      ? failedRules
          .map((r) => (r.text || "").trim().slice(0, 120))
          .filter(Boolean)
          .slice(0, 3)
          .join(" | ")
      : "None recorded.";
  const runawayNotes = hitRunaway
    ? "Execution stopped by fail-safe guardrails before convergence."
    : "None triggered.";
  const recommendations = compliant
    ? "Proceed with the governed output; retain evidence of rules applied and clarifications."
    : "Review flagged rules/conflicts, address clarifications, and rerun for governance alignment.";

  const summarySection = [
    "NARRATIVE SUMMARY",
    `- ${summaryText}`,
  ];

  const detailSection = [
    "DIAGNOSTIC DETAILS",
    `- Outcome Summary: ${outcomeSummary}`,
    `- Governance Alignment: ${governanceAlignment}`,
    `- Cycle Behavior: ${cycleBehavior}`,
    `- Clarifications: ${clarificationSummary}`,
    `- Inferred Constraints: ${inferredSummary}`,
    `- Confidence & Tradeoffs: ${confidenceSummary}`,
    `- Rule Failures: ${ruleFailureSummary}`,
    `- Runaway / Fail-Safe Notes: ${runawayNotes}`,
    `- Recommendations: ${recommendations}`,
  ];

  return [...summarySection, "", ...detailSection].join("\n");
}

// --- OpenAI helper (429-safe retry + backoff) -------------------------------

async function callOpenAIChat({
  system,
  user,
  temperature = 0.4,
  response_format,
}) {
  if (!OPENAI_API_KEY) {
    console.error("[cd/ai] OPENAI_API_KEY missing.");
    return null;
  }

  const maxRetries = 3;
  const baseDelayMs = 1500; // 1.5s base backoff

  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      const body = {
        model: MODEL_NAME,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature,
      };

      if (response_format === "json") {
        body.response_format = { type: "json_object" };
      }

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify(body),
      });

      // SUCCESS
      if (response.ok) {
        const data = await response.json();
        return data.choices?.[0]?.message?.content?.trim() || null;
      }

      // --- 429 RATE LIMIT EXCEEDED ----------------------------------------
      if (response.status === 429 && attempt < maxRetries) {
        let retryAfterHeader = response.headers.get("retry-after");
        let retryAfterSeconds = Number(retryAfterHeader);
        let delayMs;

        if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
          delayMs = retryAfterSeconds * 1000;
        } else {
          delayMs = baseDelayMs * Math.pow(2, attempt); // 1.5s -> 3s -> 6s
        }

        console.warn(
          `[cd/ai] OpenAI rate limit (429). Attempt ${
            attempt + 1
          }/${maxRetries}. Retrying in ${delayMs} ms...`
        );

        await new Promise((resolve) => setTimeout(resolve, delayMs));
        attempt++;
        continue;
      }

      // OTHER ERRORS
      const text = await response.text();
      console.error("[cd/ai] OpenAI error:", response.status, text);
      return null;
    } catch (err) {
      // NETWORK ERROR - retry
      if (attempt < maxRetries) {
        const delayMs = baseDelayMs * Math.pow(2, attempt);
        console.warn(
          `[cd/ai] Transient OpenAI error. Attempt ${
            attempt + 1
          }/${maxRetries}. Retrying in ${delayMs} ms...`,
          err
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        attempt++;
        continue;
      }

      console.error("[cd/ai] OpenAI call fatal error:", err);
      return null;
    }
  }

  // Should not normally reach
  return null;
}

// --- Exports -----------------------------------------------------------------

module.exports = {
  runGovernedWorkflow,
  parseRulesFromGoal,
  parseGovernanceEnvelope,
  detectGovernanceViolations,
};
