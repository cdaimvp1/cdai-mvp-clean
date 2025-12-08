const { callOpenAIChat } = require("./openaiChatUtil");

function initialValidationState() {
  return {
    forbiddenHits: [],
    wordCountOk: true,
    artifactsOk: true,
    impliedReliabilityOk: true,
    isCompliant: false,
  };
}

async function analyticalPass(
  currentText,
  { input, rules, governanceStrictness, governanceEnvelope }
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
- ENVELOPE APPLICATION FIX: Apply envelope directives (tone, safety, structure, decoys) strictly before other edits.
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

Governance envelope (canonicalized):
${JSON.stringify(governanceEnvelope || {}, null, 2)}

Current draft (preserve its overall format if possible):
${currentText}

Strictness coefficient: ${governanceStrictness.toFixed(2)}

Be conservative: when unsure, prefer to tighten language rather than relax it.
Do NOT flatten formatting unless the rules clearly require a structural change.
If you suggest inferredConstraints, they MUST be grounded in the task or hints and you must assign realistic confidence scores.
  `;

  const callChat =
    typeof globalThis.callOpenAIChat === "function"
      ? globalThis.callOpenAIChat
      : callOpenAIChat;

  const raw = await callChat({
    system,
    user,
    temperature: 0.2,
    response_format: "json",
  });

  const fallbackResult = () => ({
    rewrittenText: currentText,
    directives: [],
    validation: initialValidationState(),
    inferredConstraints: [],
    deltaSummary:
      "Analytical hemisphere encountered a parsing issue and preserved the previous draft.",
  });
  if (!raw || typeof raw !== "string") {
    // TEST-D-FIX: handle null/undefined responses from stubbed OpenAI calls
    return fallbackResult();
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallbackResult();
  }
  if (!parsed || typeof parsed !== "object") {
    return fallbackResult();
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

module.exports = {
  analyticalPass,
};
