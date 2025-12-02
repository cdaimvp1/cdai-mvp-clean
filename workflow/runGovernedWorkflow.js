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
} = require("./openaiClient");

const HARD_MAX_CYCLES = 25;

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
  const missing = CANONICAL_SECTIONS.filter((s) => !sections[s]);
  const hasAll = missing.length === 0;
  if (hasAll) return text;

  const rebuilt = CANONICAL_SECTIONS.map((section) => {
    const body = sections[section] || "Pending clarification; provided content was remapped to canonical sections.";
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
    if (/will\s+likely/i.test(m)) return "likely to";
    if (/expected to/i.test(m)) return "likely to";
    if (/will/i.test(m)) return "intend to";
    if (/deterministic model/i.test(m)) return "model subject to validation";
    if (/%/.test(m) || /confidence|certainty|per\s+cent|percent/i.test(m))
      return "approximate (subject to validation)";
    return "aim to";
  });

  output = output.replace(DETERMINISTIC_NUMERIC_REGEX, "approximate (subject to validation)");
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

  const forbiddenContent = {
    percentages: false,
    mathFormulas: false,
    realInstitutions: false,
    roles: false,
  };

  const safetyBoundaries = {
    noSpeculation: false,
    noLegalConclusions: false,
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

  if (/\bno speculation\b|\bnot speculate\b|\bno guessing\b/.test(lower)) {
    safetyBoundaries.noSpeculation = true;
    addExplicit("Avoid speculation; flag missing information explicitly.", 0.86, "Prompt forbids speculation.");
  }
  if (/\bno legal\b|\bno legal conclusions\b|\bavoid legal conclusions\b/.test(lower)) {
    safetyBoundaries.noLegalConclusions = true;
    addExplicit("Avoid legal conclusions or regulatory determinations.", 0.84, "Prompt forbids legal conclusions.");
  }
  if (/\bno percentages\b|\bno percent\b|%\b/.test(lower)) {
    forbiddenContent.percentages = true;
    addExplicit("Avoid percentages unless unavoidable; prefer qualitative ranges.", 0.83, "Prompt mentions no %/formulas.");
  }
  if (/\bno math\b|\bno formulas\b|\bmath formulas\b/.test(lower)) {
    forbiddenContent.mathFormulas = true;
    addExplicit("Do not include math formulas.", 0.82, "Prompt forbids formulas.");
  }
  if (/\bno real (standards|institutions|regulations|governments|countries)\b/.test(lower)) {
    forbiddenContent.realInstitutions = true;
    addExplicit("Avoid real institutions/standards/regulations.", 0.83, "Prompt forbids real institutions.");
  }
  if (/\bno roles?\b|\bno departments?\b|\bno teams?\b|\bno committees?\b|\bno boards?\b|\bno councils?\b|\bno ministries?\b/.test(lower)) {
    forbiddenContent.roles = true;
    addExplicit("Do not reference roles, departments, teams, committees, or boards.", 0.85, "Prompt forbids roles/departments.");
  }
  if (/\bno regulators\b|\bavoid regulators\b|\bno regulatory\b/.test(lower)) {
    addExplicit("Avoid regulator mentions; use internal control language instead.", 0.78, "Prompt downplays regulators.");
  }
  if (/\bno guaranteed\b|\bno guarantees\b|\bnot guaranteed\b|\bno commitments\b/.test(lower)) {
    addExplicit("Avoid commitments/guarantees/deterministic language.", 0.9, "Prompt forbids deterministic commitments.");
  }
  if (/\btone\b.*(analytical|executive|leadership)/.test(lower)) {
    addExplicit("Tone split: analytical/crisp vs. leadership/reassuring.", 0.8, "Prompt requests tone split.");
  }

  if (/\bper\s+cent\b|percent\b/.test(lower)) {
    addExplicit("Avoid percentages unless unavoidable; prefer qualitative statements.", 0.76, "Prompt hints at % usage.");
  }
  if (/\bformula\b|\bmath\b|\bequals\b/.test(lower)) {
    addExplicit("Avoid formulas/math expressions; keep qualitative.", 0.74, "Prompt hints at formulas.");
  }

  if (/\broot cause\b/.test(lower) || /\bfour\b|\b4\b/.test(lower)) {
    structureSchema.authoritativeSource = "prompt-latest";
    structureSchema.requiredSections = [...CANONICAL_SECTIONS];
    structureSchema.orderEnforced = true;
  }

  if (/\bfindings\b|\bexec note\b|\bexec summary\b/i.test(lower)) {
    contradictions.push({
      text: "3-section hint conflicts with canonical 4-section schema; enforce canonical schema.",
      confidence: 0.7,
    });
  }

  if (/\bcontradiction\b|\bconflict\b|\bmutually exclusive\b/.test(lower)) {
    addInferred("Surface contradictions explicitly and resolve in favor of latest explicit rule.", 0.7, "Prompt references contradictions.");
  }

  if (/\bcall out missing\b|\bif missing\b|\bif unclear\b|\bif vague\b|\blacking details\b/.test(lower)) {
    addInferred("Flag missing information explicitly; do not invent details.", 0.82, "Prompt references missing info.");
    conditionalLanguage.push({
      text: "If inputs are unclear, flag missing info instead of guessing.",
      confidence: 0.78,
    });
  }

  const missingInformation = /\bmissing\b|\bvague\b|\bunclear\b|\binsufficient detail\b/.test(lower);

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

// --- Validation state --------------------------------------------------------

function initialValidationState() {
  return {
    forbiddenHits: [],
    wordCountOk: true,
    artifactsOk: true,
    impliedReliabilityOk: true,
    isCompliant: false,
  };
}

function validationSummary(v) {
  const issues = [];
  if (!v.wordCountOk) issues.push("WORD_COUNT");
  if (!v.artifactsOk) issues.push("ARTIFACTS");
  if (!v.impliedReliabilityOk) issues.push("IMPLIED_RELIABILITY");
  if (v.forbiddenHits?.length)
    issues.push(`FORBIDDEN: ${v.forbiddenHits.join(", ")}`);
  return issues.length
    ? `Violations: ${issues.join("; ")}`
    : "All constraints satisfied.";
}

function detectGovernanceViolations(text) {
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

  function addHit({ matchIndex = 0, snippet, severity = "hard", section, confidence = 0.78 }) {
    const resolvedSection =
      section || findSectionForIndex(matchIndex) || "global";
    const cleanedSnippet = (snippet || "").toString().slice(0, 200);
    hits.push({
      section: resolvedSection,
      snippet: cleanedSnippet,
      severity,
      confidence,
    });
  }

  // Structure enforcement
  CANONICAL_SECTIONS.forEach((section) => {
    if (!sections[section]) {
      structureOk = false;
      addHit({
        snippet: `Missing required section: ${section}`,
        severity: "hard",
        confidence: 0.88,
      });
    }
  });

  const extraHeading = body.match(
    /(?:^|\n)\s*([A-Z][A-Za-z\s]+):\s*$/m
  );
  if (extraHeading && !CANONICAL_SECTIONS.includes(extraHeading[1])) {
    structureOk = false;
    addHit({
      snippet: `Extra section detected: ${extraHeading[1]}`,
      severity: "hard",
      confidence: 0.72,
    });
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
    });
  }

  REAL_INSTITUTIONS.forEach((inst) => {
    if (lower.includes(inst)) {
      riskyTokens.add(inst);
      addHit({
        snippet: `Real institution reference "${inst}"`,
        severity: "hard",
        confidence: 0.76,
      });
    }
  });

  // Tone & near-violations
  const leadership = sections["Leadership Summary"] || "";
  if (leadership) {
    const leadershipDeterministic = leadership.match(/\b(ensure|guarantee|will|commit)\b/i);
    if (leadershipDeterministic) {
      riskyTokens.add(leadershipDeterministic[0].toLowerCase());
      addHit({
        snippet: `Leadership deterministic verb "${leadershipDeterministic[0]}"`,
        section: "Leadership Summary",
        severity: "hard",
        confidence: 0.82,
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
        section: idx === 0 ? "Root Cause" : idx === 1 ? "Remediation" : "Governance Enhancement",
        severity: "warning",
        confidence: 0.65,
      });
    }
  });

  const forbiddenHits = hits
    .filter((h) => h.severity === "hard")
    .map((h) => h.snippet);

  const impliedReliabilityOk =
    forbiddenHits.filter((h) =>
      /deterministic|numeric|%|per\s+cent|guarantee|ensure|will|commit|expected/i.test(h)
    ).length === 0;

  const hardCount = hits.filter((h) => h.severity === "hard").length;
  const warningCount = hits.filter((h) => h.severity === "warning").length;
  const precisionScore = Math.max(
    0,
    Number((1 - hardCount * 0.12 - warningCount * 0.05).toFixed(2))
  );

  return {
    forbiddenHits,
    wordCountOk: true,
    artifactsOk: structureOk,
    impliedReliabilityOk,
    isCompliant: structureOk && hardCount === 0,
    detailedHits: hits,
    precisionScore,
    hardViolationCount: hardCount,
    warningCount,
    riskyTokens: [...riskyTokens],
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

// --- MCP ↔ user clarification loop ------------------------------------------

function waitForUserClarification(socket, { cycle }) {
  return new Promise((resolve) => {
    let settled = false;
    const timeoutMs = 120000; // 2 minutes

    function cleanup() {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      socket.off("clarification-response", onResponse);
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
// high   → auto-apply as system-generated rule
// medium → ask user clarification, then add as user-authorized rule
// low    → discard but record in ledger
// -----------------------------------------------------------------------------

function classifyConfidenceTier(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return "low";
  if (s >= 0.78) return "high";
  if (s >= 0.5) return "medium";
  return "low";
}

/**
 * Applies inferred constraints from the Analytical pass.
 * Returns any medium-confidence candidates so the Moderator can
 * ask the user targeted clarifications.
 */
function applyInferredConstraints({
  candidates,
  rules,
  ledger,
  socket,
  cycle,
}) {
  const mediumCandidates = [];
  const list = Array.isArray(candidates) ? candidates : [];

  list.forEach((c) => {
    const text = (c.text || "").trim();
    if (!text) return;

    const confidence =
      typeof c.confidence === "number" ? c.confidence : Number(c.score) || 0;
    const tier = classifyConfidenceTier(confidence);

    if (tier === "high") {
      // Auto-apply as system-generated rule
      const ruleObj = {
        text,
        origin: "system", // shows as system rule (blue) in UI
        status: "pending",
      };
      rules.push(ruleObj);

      ledger.push({
        timestamp: new Date().toISOString(),
        stage: "MetaGovernance",
        cycle,
        summary: `High-confidence inferred constraint added and enforced from next cycle (confidence ${confidence.toFixed(
          2
        )}).`,
        snippet: text.slice(0, 260),
      });

      // Push updated rules to UI immediately
      socket.emit("telemetry", {
        type: "governance-rules",
        rules,
      });
    } else if (tier === "medium") {
      mediumCandidates.push({ text, confidence });

      ledger.push({
        timestamp: new Date().toISOString(),
        stage: "MetaGovernance",
        cycle,
        summary: `Medium-confidence inferred constraint identified; may be escalated to user clarification (confidence ${confidence.toFixed(
          2
        )}).`,
        snippet: text.slice(0, 260),
      });
    } else {
      // low confidence → discard
      ledger.push({
        timestamp: new Date().toISOString(),
        stage: "MetaGovernance",
        cycle,
        summary: `Low-confidence inferred constraint discarded (confidence ${confidence.toFixed(
          2
        )}).`,
        snippet: text.slice(0, 260),
      });
    }
  });

  return mediumCandidates;
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
- Open with 1–2 sentences explaining that the system reached a governed stop.
- Then provide 3–4 bullet points, each naming a concrete unresolved issue
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
  }
) {
  // Normalize knobs here so server.js can stay thin.
  const effectiveStrictness = normalizeStrictness(governanceStrictness);
  const mode = normalizePerfMode(perfMode);

  // GIL-Lite semantics:
  // - If maxCycles is null/undefined → GIL-Lite controls cycles (up to HARD_MAX_CYCLES)
  // - If maxCycles is a number → treat as a HARD user cap (1–10) that we never exceed
  let userCap = null;
  if (maxCycles !== null && maxCycles !== undefined) {
    const n = Number(maxCycles);
    if (Number.isFinite(n) && n > 0) {
      userCap = normalizeMaxCycles(n);
    }
  }

  const gilActive = mode === "real" || userCap === null;

  // Reset panels (logs, ledger, rule statuses), but keep chat history.
  socket.emit("telemetry", { type: "reset" });

  // Signal GIL-Lite state to the UI.
  socket.emit("telemetry", {
    type: "gil-state",
    active: gilActive,
  });

  // Build rule objects with origin metadata (for UI colors).
  const baseRules = Array.isArray(injectedRules)
    ? injectedRules
    : parseRulesFromGoal(goal || "").map((t) => ({
        text: t,
        origin: "user",
        status: "pending",
      }));
  let rules = baseRules.map((r) =>
    typeof r === "string"
      ? { text: r, origin: "user", status: "pending" }
      : { ...r, text: r.text || "" }
  );

  // PCGP: derive governance envelope and freeze it for this run
  const envelope = governanceEnvelope || parseGovernanceEnvelope(input);
  const pcgpRules = [];
  (envelope.explicitRules || []).forEach((t) => {
    const normalized = normalizeRuleObject(t);
    pcgpRules.push({
      text: normalized.text,
      origin: "user",
      status: "pending",
      rationale: normalized.rationale,
      confidence: normalized.confidence,
    });
  });
  (envelope.inferredRules || []).forEach((t) => {
    const normalized = normalizeRuleObject(t);
    pcgpRules.push({
      text: normalized.text,
      origin: "user",
      status: "pending",
      rationale: normalized.rationale,
      confidence: normalized.confidence,
    });
  });

  // Inject structural/tone/forbidden constraints as rules for enforcement
  if (envelope.structureSchema?.requiredSections?.length) {
    pcgpRules.push({
      text: `Include sections in order: ${envelope.structureSchema.requiredSections.join(
        " > "
      )}`,
      origin: "user",
      status: "pending",
    });
  }
  if (envelope.toneSchema?.analyticalTone) {
    pcgpRules.push({
      text: "Maintain analytical tone except where plain language summary is requested.",
      origin: "user",
      status: "pending",
    });
  }
  if (envelope.toneSchema?.executiveSummaryPlainLanguage) {
    pcgpRules.push({
      text: "Executive/leadership summary must be in plain language, no jargon.",
      origin: "user",
      status: "pending",
    });
  }
  if (envelope.safetyBoundaries?.noSpeculation) {
    pcgpRules.push({
      text: "Do not speculate; flag missing information instead of guessing.",
      origin: "user",
      status: "pending",
    });
  }
  if (envelope.safetyBoundaries?.noLegalConclusions) {
    pcgpRules.push({
      text: "Avoid legal conclusions; do not imply regulatory violations.",
      origin: "user",
      status: "pending",
    });
  }
  if (envelope.safetyBoundaries?.conditionalLanguageOnly) {
    pcgpRules.push({
      text: "Use conditional language (may, could, likely); avoid absolutes.",
      origin: "user",
      status: "pending",
    });
  }
  if (envelope.forbiddenContent?.percentages) {
    pcgpRules.push({
      text: "Do not include percentages.",
      origin: "user",
      status: "pending",
    });
  }
  if (envelope.forbiddenContent?.mathFormulas) {
    pcgpRules.push({
      text: "Do not include math formulas.",
      origin: "user",
      status: "pending",
    });
  }
  if (envelope.forbiddenContent?.roles) {
    pcgpRules.push({
      text: "Do not reference roles, departments, teams, committees, or boards.",
      origin: "user",
      status: "pending",
    });
  }
  if (envelope.forbiddenContent?.realInstitutions) {
    pcgpRules.push({
      text: "Do not reference real institutions, standards bodies, governments, or countries.",
      origin: "user",
      status: "pending",
    });
  }
  if (envelope.conditionalLanguage?.length) {
    envelope.conditionalLanguage.forEach((c) =>
      pcgpRules.push({
        text: c.text || "Flag unclear inputs; use conditional language.",
        origin: "system",
        status: "pending",
        confidence: c.confidence || 0.7,
      })
    );
  }
  if (envelope.missingInformation) {
    pcgpRules.push({
      text: "Flag missing information explicitly; do not guess.",
      origin: "system",
      status: "pending",
    });
  }
  if (envelope.decoyInstruction?.length) {
    envelope.decoyInstruction.forEach((d) =>
      pcgpRules.push({
        text: d.text,
        origin: "system",
        status: "decoy",
        confidence: d.confidence || 0.7,
      })
    );
  }

  rules = [...rules, ...pcgpRules];

  // Initialize ledger with any pre-existing governance entries (normalized)
  let ledger = Array.isArray(baseLedger)
    ? baseLedger.map((entry) => ({
        cycle: entry.cycle ?? 0,
        stage: entry.stage || "Governance",
        ...entry,
      }))
    : [];
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
    summary: `Governance Envelope initialized with ${envelope.explicitRules.length} explicit rules, ${envelope.inferredRules.length} inferred rules.`,
    snippet: `Sections: ${envelope.structureSchema.requiredSections.join(", ") || "none"}`,
  });

  // Context drift detection before cycles (skip when no rules exist)
  if (rules.length > 0) {
    const drift = await checkContextDrift(input, rules);
    if (drift?.driftDetected) {
      const suggestionText =
        (drift.rulesToSuggestClearing || []).length > 0
          ? `Suggested rules to clear: ${drift.rulesToSuggestClearing
              .map((i) => `Rule ${i + 1}`)
              .join(", ")}.`
          : "";
      const msg = `This task appears unrelated to your current governance rules. Would you like to clear them? ${suggestionText}`;
      ledger.push({
        timestamp: new Date().toISOString(),
        stage: "ContextDrift",
        cycle: 0,
        summary: msg,
        snippet: drift.explanation || "",
      });
      const narrative = await generateGovernanceNarrative({
        summary: msg,
        explanation: drift.explanation,
        confidence: drift.confidence,
      });
      socket.emit("telemetry", {
        type: "final-output",
        text: narrative || msg,
        narrative: narrative || msg,
      });
      socket.emit("telemetry", { type: "ledger", entries: ledger });
      return;
    }
  }

  // Track stubborn violations across cycles for unresolved-conflict surfacing
  const stubbornViolations = [];

  // Mode-specific knobs
  const plannedCycles = userCap != null ? userCap : HARD_MAX_CYCLES;
  let minCycles = 1;

  if (mode === "real") {
    // REAL mode: require at least 2 cycles only when user did not set a 1-cycle cap.
    if (userCap === 1) {
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
    });
  }

  // Tell UI how many cycles we plan (for animation only)
  socket.emit("telemetry", {
    type: "cycle-plan",
    plannedCycles,
  });

  // Initialize rules panel
  socket.emit("telemetry", {
    type: "governance-rules",
    rules,
  });

  socket.emit("telemetry", {
    type: "mcp-status",
    status: "Starting",
    detail: `Initializing governed workflow in ${mode.toUpperCase()} mode…`,
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

    if (cycle === 1) {
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
    });

    currentText = analyticalResult.rewrittenText;
    validation = analyticalResult.validation;

    // Meta-governance: handle inferred constraints from this cycle
    const mediumCandidates = applyInferredConstraints({
      candidates: analyticalResult.inferredConstraints,
      rules,
      ledger,
      socket,
      cycle,
    });

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
      mediumCandidates,
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
        "The MCP needs a brief clarification to choose between competing interpretations of your request. Please restate what you want in 1–2 sentences.";
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
    const postCreativeValidation = await validatorPass(currentText, {
      input,
      rules,
      governanceStrictness: effectiveStrictness,
    });

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
      stubbornViolations.push({
        cycle,
        summary,
        forbiddenHits: validation.forbiddenHits || [],
      });
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

    const canConverge =
      hardCount === 0 &&
      noNewWarningsStreak >= 2 &&
      introducedRiskTokens.length === 0 &&
      cycle >= minCycles;

    const runaway =
      stubbornViolations.length >= 5 || cycle === HARD_MAX_CYCLES;

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

  if (!converged && stubbornViolations.length > 0) {
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

  const narrative = buildNarrativeReport({
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

  socket.emit("telemetry", { type: "ledger", entries: ledger });
  socket.emit("telemetry", { type: "final-output", text: finalText, narrative });
}

// --- Turbo workflow (ultra-fast, approximate governance) --------------------

async function runTurboWorkflow(
  socket,
  { input, goal, rules, governanceStrictness, ledger }
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

Governance rules (high level – do your best within a single pass):
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

  socket.emit("telemetry", { type: "governance-rules-final", rules: turboFinalRules });
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

  const narrative = buildNarrativeReport({
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
  });

  socket.emit("telemetry", { type: "final-output", text, narrative });
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
  { input, rules, governanceStrictness }
) {
  const system = `
You are the ANALYTICAL hemisphere in the cd\\ai governed architecture.

Your responsibilities:
- Enforce governance constraints strictly,
- Make minimal necessary edits to the draft,
- Enforce the canonical four-section schema (Root Cause, Remediation, Governance Enhancement, Leadership Summary) when not present,
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
  "deltaSummary": "1–2 sentence explanation of what you changed THIS CYCLE in clear business language."
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
  "moderatorSummary": "1–2 sentence summary of how you constrained the Creative behavior",
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
  1–2 sentences. The question should summarize the most important uncertainty.
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
  "deltaSummary": "1–2 sentence summary of how you improved tone/readability this cycle"
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

async function validatorPass(text, { input, rules, governanceStrictness }) {
  const evaluation = detectGovernanceViolations(text);
  const base = initialValidationState();
  const merged = { ...base, ...evaluation };
  merged.isCompliant =
    merged.artifactsOk &&
    merged.impliedReliabilityOk &&
    (merged.forbiddenHits || []).length === 0 &&
    (merged.hardViolationCount || 0) === 0;
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
          delayMs = baseDelayMs * Math.pow(2, attempt); // 1.5s → 3s → 6s
        }

        console.warn(
          `[cd/ai] OpenAI rate limit (429). Attempt ${
            attempt + 1
          }/${maxRetries}. Retrying in ${delayMs} ms…`
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
      // NETWORK ERROR — retry
      if (attempt < maxRetries) {
        const delayMs = baseDelayMs * Math.pow(2, attempt);
        console.warn(
          `[cd/ai] Transient OpenAI error. Attempt ${
            attempt + 1
          }/${maxRetries}. Retrying in ${delayMs} ms…`,
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
