// V1.1-PHASE1: tokenizer
function tokenize(raw) {
  if (!raw) return [];
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, "")
    .split(/\s+/)
    .filter(Boolean);
}

// V1.1-PHASE1: heuristics
// TEST-A-FIX: broaden verb/noun coverage for grammar parsing
const VERB_LIST = [
  "create",
  "draft",
  "analyze",
  "summarize",
  "write",
  "generate",
  "plan",
  "design",
  "evaluate",
  "compare",
  "execute",
  "deploy",
  "approve",
  "send",
  "finalize",
  "simulate",
  "explain",
  "analyze",
];
const NOUN_LIST = [
  "report",
  "memo",
  "email",
  "summary",
  "plan",
  "proposal",
  "decision",
  "analysis",
  "document",
  "draft",
  "update",
  "agreement",
  "contract",
  "deployment",
  "workflow",
  "sourcing",
  "options",
  "approaches",
  "network",
  "levels",
];
const QUALIFIERS = ["draft", "simulate", "simulation", "hypothetical", "example", "sample"];
const RISK_MARKERS = ["execute", "deploy", "finalize", "approve", "send", "external", "production", "prod"];
const VERB_SUFFIXES = ["ing", "ed", "es", "s"]; // TEST-G-FIX: lightweight verb stemming

// V1.1-PHASE1: parse tokens → grammar roles
function parseTokens(tokens) {
  const verbs = [];
  const nouns = [];
  const modifiers = [];

  for (const t of tokens) {
    const normalizedVerb = normalizeVerbToken(t);
    if (normalizedVerb) {
      verbs.push(normalizedVerb);
      continue;
    }
    if (looksLikeNoun(t)) {
      nouns.push(t);
    } else {
      modifiers.push(t);
    }
  }

  return { verbs, nouns, modifiers };
}

function looksLikeVerb(t) {
  return Boolean(normalizeVerbToken(t));
}

function looksLikeNoun(t) {
  return NOUN_LIST.includes(t);
}

function isQualifier(t) {
  return QUALIFIERS.includes(t);
}

function isRiskMarker(t) {
  return RISK_MARKERS.includes(t);
}

// V1.1-PHASE1: semantic role extraction
function semanticRoles({ verbs, nouns, modifiers }) {
  // TEST-A-FIX: include verb-based risk markers
  const allRiskMarkers = [
    ...(verbs || []).filter((v) => isRiskMarker(v)),
    ...(modifiers || []).filter((m) => isRiskMarker(m)),
  ];
  return {
    primaryVerb: verbs[0] ?? null,
    primaryObject: nouns[0] ?? null,
    qualifiers: modifiers.filter((m) => isQualifier(m)),
    riskMarkers: allRiskMarkers,
  };
}

module.exports = {
  tokenize,
  parseTokens,
  semanticRoles,
  looksLikeVerb,
  looksLikeNoun,
  isQualifier,
  isRiskMarker,
};

// TEST-G-FIX: normalize verbs with simple suffix stripping for colloquial inputs
function normalizeVerbToken(token) {
  if (!token) return null;
  if (VERB_LIST.includes(token)) return token;
  for (const suffix of VERB_SUFFIXES) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 3) {
      const stem = token.slice(0, -suffix.length);
      if (VERB_LIST.includes(stem)) return stem;
      if (suffix === "ing" && VERB_LIST.includes(`${stem}e`)) return `${stem}e`; // TEST-G-FIX: handle dropped-e gerunds
    }
  }
  return null;
}
