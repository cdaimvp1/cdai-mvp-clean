const { callOpenAIChat } = require("./openaiChatUtil");

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
    governanceEnvelope,
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
- ENVELOPE APPLICATION FIX: Enforce envelope tone, safety, structure, and decoy handling prior to Creative handoff.

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

Governance envelope (canonicalized):
${JSON.stringify(governanceEnvelope || {}, null, 2)}

Guidance:
- If you are reasonably confident (e.g., confidence >= 0.7) that you understand
  the user's intent and the governance rules are unambiguous, set
  "needsUserClarification": false.
- If there are medium-confidence inferred constraints AND you are not confident
  that they should be auto-applied, set "needsUserClarification": true and craft
  a SINGLE clear question that a senior business stakeholder could answer in
  1G€“2 sentences. The question should summarize the most important uncertainty.
  `;

  const fallback = () => ({
    moderatedPrompt:
      "You are the Creative hemisphere. Improve readability and flow without relaxing any governance constraints or reintroducing forbidden terms. Keep the length and structure close to the current draft.",
    moderatorSummary:
      "Moderator fallback: used a default conservative prompt to keep Creative changes bounded.",
    confidence: 0.6,
    needsUserClarification: false,
    userQuestion: null,
  });
  if (!process.env.OPENAI_API_KEY) {
    console.warn("[cd/ai] OPENAI_API_KEY missing — using safe fallback mode (clarification-loop)");
    const baseFallback = fallback();
    baseFallback.fallback = { ok: true, value: null, reason: "fallback-no-key" };
    return baseFallback;
  }

  const callChat =
    typeof globalThis.callOpenAIChat === "function"
      ? globalThis.callOpenAIChat
      : callOpenAIChat;

  const raw = await callChat({
    system,
    user,
    temperature: 0.25,
    response_format: "json",
  });
  if (!raw || typeof raw !== "string") {
    // TEST-D-FIX: ensure moderator survives stubbed responses
    return fallback();
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback();
  }
  if (!parsed || typeof parsed !== "object") {
    return fallback();
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

module.exports = {
  moderatorPass,
};
