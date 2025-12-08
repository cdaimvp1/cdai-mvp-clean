const { normalizeRules } = require("./ruleNormalizer");

const ACTIONABLE_PATTERNS =
  /\b(deploy|execute|launch|ship|release|submit|file|implement|run|send|publish|approve|sign)\b/gi;
const EXTERNAL_REGEX = /\b(external|outside|third[-\s]?party|public)\b/gi;
const WEB_REGEX = /\b(http|https|www\.|browser|internet|web)\b/gi;
const PUBLIC_DATA_REGEX =
  /\b(public data|open data|public dataset|shared dataset)\b/gi;

const HARD_CONSTRAINTS = new Set([
  "no_external_sharing",
  "no_web_access",
  "no_public_data_integration",
  "citation_required",
  "provenance_required",
  "no_production_execution",
  "hard_block_action",
  "external_data_must_be_flagged",
]);

const ISSUE_ID_PREFIX = "validator-issue";

const CANONICAL_DETERMINISTIC_REGEX =
  /\b(will|ensure|guarantee|commit|100%|100\s*percent|per\s+cent|percent|certainty|confidence)\b/gi;
const CANONICAL_ROLE_REGEX =
  /\b(task\s*force|committee|department|team|board|council|executive\s+team|governance\s+circle)\b/gi;
const CANONICAL_REGULATORY_REGEX =
  /\b(iso|hipaa|regulator|regulatory|audit[- ]ready|compliance|ministry)\b/gi;
const CANONICAL_FORMULA_REGEX =
  /\b\d+\s*[\+\-\*\/]\s*\d+\b|(?:one|two|three|four|five|six|seven|eight|nine|ten)\s+of\s+(?:one|two|three|four|five|six|seven|eight|nine|ten)\b|per\s+cent/gi;

const DEFAULT_CANONICAL_RULES = [
  {
    id: "canon-deterministic",
    text: "Canonical guardrail: avoid deterministic commitments or guarantees unless explicitly required.",
    effect: "block",
  },
  {
    id: "canon-roles",
    text: "Canonical guardrail: remove committees, departments, or teams unless envelope grants role references.",
    effect: "block",
  },
  {
    id: "canon-regulatory",
    text: "Canonical guardrail: do not claim regulatory alignment unless rules enable it.",
    effect: "block",
  },
  {
    id: "canon-formula",
    text: "Canonical guardrail: avoid numeric formulas or per cent confidence claims by default.",
    effect: "block",
  },
  {
    id: "canon-spelled-percent",
    text: "Canonical guardrail: spelled-out percentages (per cent) require explicit approval.",
    effect: "block",
  },
  {
    id: "canon-fractional-formula",
    text: "Canonical guardrail: prose fractions such as three of five are not permitted unless rules allow formulas.",
    effect: "block",
  },
  {
    id: "canon-leadership-hedge",
    text: "Canonical guardrail: Leadership Summary must stay hedged (no deterministic promises).",
    effect: "block",
  },
];

function detectGovernanceViolations(text, { rules = [], context = {} } = {}) {
  let normalizedRules = normalizeRules(rules || []);
  if (!normalizedRules.length) {
    normalizedRules = normalizeRules(DEFAULT_CANONICAL_RULES);
  }
  const absoluteIssues = [];
  const contextualIssues = [];
  const softIssues = [];
  const evaluationLog = [];
  const summarizedContext = summarizeContext(context);

  const lowerText = (text || "").toLowerCase();

  let issueCounter = 0;
  normalizedRules.forEach((rule, idx) => {
    const issueCategory = classifyRule(rule);
    const checks = deriveChecksForRule(rule);
    const match = runChecks(checks, text || "", lowerText);
    evaluationLog.push({
      ruleId: rule.id || `rule-${idx + 1}`,
      category: issueCategory,
      matched: !!match,
      detector: match?.detector || null,
      rationale: match?.rationale || "No signals detected for this rule.",
      snippet: match?.snippet || null,
      timestamp: new Date().toISOString(),
      context: summarizedContext,
    });
    if (!match) return;

    const issueId = `${ISSUE_ID_PREFIX}-${rule.id || idx}-${issueCounter++}`;
    const issue = buildIssuePayload(rule, issueCategory, issueId, match);

    if (issueCategory === "absolute") {
      absoluteIssues.push(issue);
    } else if (issueCategory === "contextual") {
      contextualIssues.push(issue);
    } else {
      softIssues.push(issue);
    }
  });

  const unresolvedAbsolute = absoluteIssues.filter((issue) => !issue.override);
  const unresolvedContextual = contextualIssues.filter(
    (issue) => !issue.override
  );
  const qualityState = unresolvedAbsolute.length
    ? "red"
    : unresolvedContextual.length
    ? "yellow"
    : "green";

  return {
    qualityState,
    requiresCorrection: unresolvedAbsolute.length > 0,
    requiresHumanReview:
      unresolvedAbsolute.length > 0 || unresolvedContextual.length > 0,
    absoluteIssues,
    contextualIssues,
    softIssues,
    finalText: text,
    diagnostics: {
      totalRulesEvaluated: normalizedRules.length,
      automaticIssuesDetected:
        absoluteIssues.length + contextualIssues.length + softIssues.length,
      generatedAt: new Date().toISOString(),
      contextSummary: summarizedContext,
      assessmentLog: evaluationLog,
    },
    assessmentLog: evaluationLog,
  };
}

function summarizeContext(context = {}) {
  if (!context || typeof context !== "object") return null;
  const summary = {};
  if (context.sessionId) summary.sessionId = context.sessionId;
  if (context.requestId) summary.requestId = context.requestId;
  if (context.hemisphere) summary.hemisphere = context.hemisphere;
  if (context.strictnessLevel !== undefined)
    summary.strictnessLevel = context.strictnessLevel;
  return Object.keys(summary).length ? summary : null;
}

function classifyRule(rule = {}) {
  if (!rule) return "soft";
  if (
    rule.effect === "block" ||
    rule.effect === "deny" ||
    (rule.constraints || []).some((c) => HARD_CONSTRAINTS.has(c))
  ) {
    return "absolute";
  }
  if (
    rule.effect === "require_review" ||
    rule.effect === "require_clarification" ||
    rule.scope === "execution" ||
    rule.scope === "decision"
  ) {
    return "contextual";
  }
  return "soft";
}

function deriveChecksForRule(rule = {}) {
  const checks = [];
  const constraints = rule.constraints || [];
  constraints.forEach((constraint) => {
    switch (constraint) {
      case "no_external_sharing":
      case "external_data_must_be_flagged":
        checks.push({
          name: constraint,
          getRegex: () => new RegExp(EXTERNAL_REGEX.source, "gi"),
          rationale:
            "Rule forbids external sharing yet the output references external or public recipients.",
        });
        break;
      case "no_public_data_integration":
        checks.push({
          name: constraint,
          getRegex: () => new RegExp(PUBLIC_DATA_REGEX.source, "gi"),
          rationale:
            "Rule disallows public data integration but public/open data terms were detected.",
        });
        break;
      case "no_web_access":
        checks.push({
          name: constraint,
          getRegex: () => new RegExp(WEB_REGEX.source, "gi"),
          rationale:
            "Rule disallows web access but web/internet references appeared in the output.",
        });
        break;
      case "no_production_execution":
      case "hard_block_action":
        checks.push(buildExecutionCheck(constraint));
        break;
      default:
        break;
    }
  });

  if (rule.scope === "execution") {
    checks.push(buildExecutionCheck("execution-scope"));
  }

  const rawText = normalizeRuleText(rule);
  if (/external|public data|third[-\s]?party/.test(rawText)) {
    checks.push({
      name: "raw-external-reference",
      getRegex: () => new RegExp(EXTERNAL_REGEX.source, "gi"),
      rationale:
        "Rule references external/public restrictions and the output referenced external recipients.",
    });
  }
  if (/execute|deployment|production/i.test(rawText)) {
    checks.push(buildExecutionCheck("raw-execution-reference"));
  }
  if (/web|browser|internet/.test(rawText)) {
    checks.push({
      name: "raw-web-reference",
      getRegex: () => new RegExp(WEB_REGEX.source, "gi"),
      rationale:
        "Rule references web restrictions and the output referenced web/internet access.",
    });
  }

  appendCanonicalChecks(rawText, checks);

  return checks;
}

function appendCanonicalChecks(rawText, checks) {
  const normalized = (rawText || "").toLowerCase();
  const isLeadershipRule = /\bleadership summary\b/.test(normalized);
  if (!isLeadershipRule && /deterministic|commitment|guarantee|hedg|will\b/.test(normalized)) {
    checks.push({
      name: "canonical-deterministic-language",
      getRegex: () => new RegExp(CANONICAL_DETERMINISTIC_REGEX.source, "gi"),
      rationale: "Canonical guardrail forbids deterministic commitments without explicit approval.",
    });
  }
  if (/role|team|committee|department|task\s*force|executive/.test(normalized)) {
    checks.push({
      name: "canonical-role-reference",
      getRegex: () => new RegExp(CANONICAL_ROLE_REGEX.source, "gi"),
      rationale: "Canonical guardrail removes committees/teams unless explicitly permitted.",
    });
  }
  if (/regulator|iso|audit|compliance|ministry/.test(normalized)) {
    checks.push({
      name: "canonical-regulatory-reference",
      getRegex: () => new RegExp(CANONICAL_REGULATORY_REGEX.source, "gi"),
      rationale: "Canonical guardrail disallows regulatory claims without explicit instruction.",
    });
  }
  if (/formula|numeric|percent|per\s+cent/.test(normalized)) {
    checks.push({
      name: "canonical-formula-detection",
      getRegex: () => new RegExp(CANONICAL_FORMULA_REGEX.source, "gi"),
      rationale: "Canonical guardrail discourages numeric formulas or confidence claims by default.",
    });
  }
  if (isLeadershipRule) {
    checks.push({
      name: "canonical-leadership-deterministic",
      getRegex: () =>
        new RegExp(
          "leadership summary[\\s\\S]{0,160}?\\b(will|ensure|guarantee|commit|must|should)\\b",
          "gi"
        ),
      rationale: "Leadership Summary must remain hedged; deterministic language detected.",
    });
  }
}

function buildExecutionCheck(name) {
  return {
    name,
    getRegex: () => new RegExp(ACTIONABLE_PATTERNS.source, "gi"),
    rationale:
      "Rule constrains execution language yet the output appears to reference executable actions.",
  };
}

function normalizeRuleText(rule = {}) {
  if (!rule) return "";
  if (typeof rule.raw === "string") return rule.raw.toLowerCase();
  if (rule.raw && typeof rule.raw === "object") {
    return (
      (
        rule.raw.description ||
        rule.raw.text ||
        rule.raw.rule ||
        rule.raw.raw ||
        ""
      ).toLowerCase()
    );
  }
  if (typeof rule.text === "string") return rule.text.toLowerCase();
  if (typeof rule.description === "string")
    return rule.description.toLowerCase();
  return "";
}

function runChecks(checks, text, lowerText) {
  for (const check of checks) {
    const regex = check.getRegex();
    const match = regex.exec(lowerText);
    if (!match) continue;
    return {
      detector: check.name,
      rationale: check.rationale,
      snippet: buildSnippet(text, match.index, match[0]),
    };
  }
  return null;
}

function buildSnippet(text, index, matchValue) {
  if (!text) return "";
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + (matchValue?.length || 0) + 40);
  return text.slice(start, end).trim();
}

function buildIssuePayload(rule, category, issueId, match) {
  return {
    id: issueId,
    ruleId: rule.id || null,
    category,
    ruleText: normalizeRuleText(rule),
    rationale: match.rationale,
    evidence: match.snippet,
    detector: match.detector,
    timestamp: new Date().toISOString(),
    override: null,
  };
}

module.exports = { detectGovernanceViolations };
