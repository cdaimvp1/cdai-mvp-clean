const {
  classifyGovernanceIntent,
  checkContextDrift,
  generateGovernanceNarrative,
} = require("../workflow/openaiClient");

// Stub fetch to avoid network; respond deterministically based on prompt content
global.fetch = async (_url, options = {}) => {
  const body = JSON.parse(options.body || "{}");
  const system = body.messages?.[0]?.content || "";
  const user = body.messages?.[1]?.content || "";
  let content = "{}";

  if (system.includes("Classify the user message")) {
    if ((user || "").toLowerCase().includes("add rule")) {
      content = JSON.stringify({
        label: "rule_addition",
        confidence: 0.92,
        ruleCandidates: ["Avoid medical claims."],
        task: null,
      });
    } else {
      content = JSON.stringify({
        label: "task",
        confidence: 0.8,
        ruleCandidates: [],
        task: user,
      });
    }
  } else if (system.includes("Assess whether the incoming task")) {
    const driftDetected = (user || "").toLowerCase().includes("unrelated");
    content = JSON.stringify({
      driftDetected,
      rulesToSuggestClearing: driftDetected ? [1] : [],
      explanation: driftDetected ? "Task appears unrelated." : "Aligned.",
      confidence: 0.8,
    });
  } else if (system.includes("Produce a concise governance narrative")) {
    content = "Narrative: governance update recorded.";
  }

  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content } }],
    }),
  };
};

(async () => {
  try {
    const classification = await classifyGovernanceIntent("Please add rule: Avoid medical claims.");
    if (classification.label !== "rule_addition") {
      throw new Error("Classification failed for rule addition.");
    }

    const drift = await checkContextDrift("This task is unrelated", [
      { text: "Keep tone formal." },
      { text: "Avoid speculation." },
    ]);
    if (!drift.driftDetected) {
      throw new Error("Drift detection did not trigger for unrelated task.");
    }

    const narrative = await generateGovernanceNarrative({
      summary: "Added rule and detected drift.",
    });
    if (!narrative || typeof narrative !== "string") {
      throw new Error("Narrative generation failed.");
    }

    console.log("Conversational Governance + Narrative Layer successfully integrated.");
  } catch (err) {
    console.error("Conversational governance tests failed:", err.message || err);
    process.exit(1);
  }
})();
