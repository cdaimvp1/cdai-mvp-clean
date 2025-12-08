const { callOpenAIChat } = require("./openaiChatUtil");

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

module.exports = {
  taskAgentPass,
};
