const { callOpenAIChat } = require("./openaiChatUtil");

async function creativePass(
  currentText,
  { input, rules, governanceStrictness, moderatedPrompt, userFeedback, governanceEnvelope }
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
- ENVELOPE APPLICATION FIX: honor envelope tone/safety/structure/decoy directives while rewriting.

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

Governance envelope (canonicalized):
${JSON.stringify(governanceEnvelope || {}, null, 2)}
  `;

  const callChat =
    typeof globalThis.callOpenAIChat === "function"
      ? globalThis.callOpenAIChat
      : callOpenAIChat;

  const raw = await callChat({
    system,
    user,
    temperature: 0.4,
    response_format: "json",
  });

  const fallback = () => ({
    rewrittenText: currentText,
    deltaSummary:
      "Creative hemisphere encountered a parsing issue and preserved the prior draft.",
  });
  if (!raw || typeof raw !== "string") {
    // TEST-D-FIX: guard against null responses in tests
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
    rewrittenText: parsed.rewrittenText || currentText,
    deltaSummary:
      parsed.deltaSummary ||
      "Creative hemisphere refined clarity, flow, and tone while respecting governance constraints.",
  };
}

module.exports = {
  creativePass,
};
