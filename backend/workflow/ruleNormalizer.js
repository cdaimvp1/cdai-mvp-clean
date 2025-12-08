// V1.1-PHASE2: Rule Normalizer
let ruleSeq = 0;
function generateRuleId() {
  ruleSeq += 1;
  return `rule-${ruleSeq}`;
}
// TEST-B-FIX: deterministic ID based on text
function deterministicRuleId(text) {
  const base = (text || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!base) return generateRuleId();
  return `rule-${base.slice(0, 12)}`;
}

// TEST-B-FIX: helper to extract raw text safely
function ruleText(r) {
  if (typeof r === "string") return r;
  return (r.description || r.text || r.raw || "") + "";
}

// Heuristics for effects, scope, constraints
function extractEffect(r = {}) {
  const text = ruleText(r).toLowerCase();
  // TEST-B-FIX: broaden block detection
  if (
    /(deny|block|forbid|prohibit|do not proceed|under no circumstances|never execute)/.test(text) ||
    r.effect === "block" ||
    r.effect === "deny"
  ) {
    return "block";
  }
  if (/(require\s+review|requires\s+review|human review|approve without review|must not approve)/.test(text) || r.effect === "require_review") {
    return "require_review";
  }
  if (/(clarification|ask before)/.test(text) || r.effect === "require_clarification") {
    return "require_clarification";
  }
  if (/(allow|permitted|may)/.test(text) || r.effect === "allow") {
    return "allow";
  }
  return r.effect ?? null;
}

function extractScope(r = {}) {
  const text = ruleText(r).toLowerCase();
  if (/(execution|execute|deploy|run)/.test(text)) return "execution";
  if (/(decision|approve|sign|finalize)/.test(text)) return "decision";
  if (/(analyz|analysis|evaluate|compare)/.test(text)) return "analysis";
  if (/(draft|write|compose|summarize|generate)/.test(text)) return "drafting";
  if (/(data|query|fetch|retrieve)/.test(text)) return "data_access";
  return r.scope ?? "global";
}

function extractConstraintKeywords(r = {}) {
  const text = ruleText(r).toLowerCase();
  const found = [];
  if (/no external|external sharing|share externally|externally|external/.test(text)) found.push("no_external_sharing");
  if (/must log|audit/.test(text)) found.push("must_log");
  if (/human review|approval required|requires review/.test(text)) found.push("requires_review");
  if (/no production|no prod|not in prod/.test(text)) found.push("no_production_execution");
  // TEST-B-FIX: add irreversible and clarification guidance
  if (/irreversible/.test(text)) found.push("irreversible_action_warning");
  if (/clarify|clarification|alternatives if.*unclear|if user intent is unclear/.test(text)) found.push("clarification_guideline");
  // V1.2-PHASE5-FIX: detect data scope governance constraints
  if (/no web|internal only|stay in internal|work[-\s]*mode/.test(text)) found.push("no_web_access");
  if (/(cite|citation|attribution|credit sources)/.test(text)) found.push("citation_required");
  if (/(provenance|track origin|source tracing|origin of external)/.test(text)) found.push("provenance_required");
  if (
    /no public data|do not mix public|public data integration|no public integration|integrate public data|public data with internal|mix internal and public/.test(
      text
    )
  ) {
    found.push("no_public_data_integration"); // V1.2-PHASE5-FIX: broaden detection for mixed public-data prohibitions
  }
  if (/web access allowed|allowed to use web|may use web/.test(text)) found.push("web_access_allowed");
  if (/external data must be flagged|flag external data/.test(text)) found.push("external_data_must_be_flagged");
  return found;
}

// V1.1-PHASE2: normalize raw governance rules
function normalizeRules(rawRules = []) {
  const list = [];
  for (const r of rawRules || []) {
    const text = ruleText(r);
    list.push({
      id: r.id ?? deterministicRuleId(text),
      source: r.source ?? "user",
      effect: extractEffect(r),
      scope: extractScope(r),
      constraints: extractConstraintKeywords(r),
      raw: r,
    });
  }
  return list;
}

// V1.1-PHASE2: derive primitive constraints from normalized rules
function deriveConstraints(normalizedRules = []) {
  const constraints = [];
  for (const r of normalizedRules) {
    for (const c of r.constraints) {
      const hardConstraintTypes = new Set([
        "no_external_sharing",
        "requires_review",
        "no_web_access",
        "citation_required",
        "provenance_required",
        "no_public_data_integration",
      ]);
      const severity =
        hardConstraintTypes.has(c) || r.effect === "block" || r.effect === "require_review" ? "hard" : "soft"; // V1.2-PHASE5-FIX: scope-aware severity
      constraints.push({
        type: c,
        severity,
        ruleId: r.id,
        source: r.source,
      });
    }
    if (r.effect === "deny" || r.effect === "block") {
      constraints.push({
        type: "hard_block_action",
        severity: "hard",
        ruleId: r.id,
        source: r.source,
      });
    }
    if (r.effect === "require_review" && !constraints.find((c) => c.type === "requires_review")) {
      constraints.push({
        type: "requires_review",
        severity: "hard",
        ruleId: r.id,
        source: r.source,
      });
    }
  }
  return constraints;
}

// V1.1-PHASE2: constraint algebra merge rules
function mergeConstraints(constraintSets = []) {
  const merged = [];
  const flat = constraintSets.flat().filter(Boolean);
  const hasHardBlock = flat.some((c) => c.type === "hard_block_action");
  if (hasHardBlock) {
    merged.push({ type: "hard_block_action", severity: "hard" });
  }
  const seen = new Set(hasHardBlock ? ["hard_block_action|hard"] : []);
  for (const c of flat) {
    if (c.type === "hard_block_action") continue;
    if (hasHardBlock && c.severity === "soft") continue;
    const key = `${c.type}|${c.severity || "soft"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(c);
  }
  // TEST-B-FIX: stable ordering for deterministic outputs
  merged.sort((a, b) => {
    if (a.type === b.type) return (a.severity || "").localeCompare(b.severity || "");
    return (a.type || "").localeCompare(b.type || "");
  });
  return merged;
}

function evaluateConstraintAlgebra(constraints = []) {
  const hasHardBlock = constraints.some((c) => c.type === "hard_block_action");
  const externalSharingProhibited = constraints.some((c) => c.type === "no_external_sharing");
  const requiresReview = constraints.some((c) => c.type === "requires_review");
  const warnings = constraints.filter((c) => c.severity === "soft").map((c) => c.type);
  // V1.2-PHASE2: data scope constraint flags
  const webAccessForbidden = constraints.some((c) => c.type === "no_web_access");
  const citationRequired = constraints.some((c) => c.type === "citation_required");
  const provenanceRequired = constraints.some((c) => c.type === "provenance_required");
  const publicIntegrationBlocked = constraints.some((c) => c.type === "no_public_data_integration");
  return {
    finalConstraints: constraints,
    summary: {
      hardBlock: hasHardBlock,
      requiresReview,
      externalSharingProhibited,
      warnings,
      total: constraints.length,
      webAccessForbidden,
      citationRequired,
      provenanceRequired,
      publicIntegrationBlocked,
    },
  };
}

module.exports = {
  normalizeRules,
  deriveConstraints,
  mergeConstraints,
  evaluateConstraintAlgebra,
};
