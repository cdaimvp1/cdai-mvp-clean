function buildResponse(content) {
  return {
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: typeof content === "string" ? content : JSON.stringify(content),
          },
        },
      ],
    }),
  };
}

function installMockOpenAIStub() {
  const previousFetch = global.fetch;

  global.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body || "{}");
    const systemPrompt = body.messages?.[0]?.content || "";
    const userPrompt =
      body.messages?.find((msg) => msg.role === "user")?.content ||
      body.messages?.[1]?.content ||
      "";
    const needsJson =
      body.response_format?.type === "json_object" ||
      body.response_format === "json";

    const respond = (payload) =>
      needsJson && typeof payload !== "string" ? buildResponse(payload) : buildResponse(payload);

    if (systemPrompt.includes("Extract TASKS ONLY")) {
      const tasks = userPrompt
        ? [
            userPrompt
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean)[0] || userPrompt.trim(),
          ]
        : [];
      return respond({ tasks });
    }

    if (systemPrompt.includes("Extract RULES ONLY")) {
      const rules = {
        explicit: [
          "Always confirm data lineage before migrating.",
          "Never expose customer records during transitions.",
        ],
        general: ["Provide a concise executive summary."],
        candidateInferred: ["Flag any risks that require validation."],
      };
      return respond({ rules });
    }

    if (systemPrompt.includes("You classify user messages for a governed AI system")) {
      return respond({
        intent: /rule/i.test(userPrompt) ? "rules" : "task",
        confidence: 0.92,
        reason: "Stubbed deterministic classifier",
      });
    }

    if (systemPrompt.includes("You are a rule-extraction engine")) {
      return respond({
        explicit: [
          { id: "HR-1", description: "Approve with GRC before going live." },
          { id: "HR-2", description: "Mask all PHI-like values." },
        ],
        inferred: [],
        contradictory: [],
        approvals: [],
      });
    }

    if (systemPrompt.includes("Task Agent") && systemPrompt.includes("governed dual-hemisphere")) {
      return respond(
        `Task Agent Draft:\n1. Capture current environment.\n2. Stage migration rehearsal.\n3. Execute with rollback gates.`
      );
    }

    if (systemPrompt.includes("ANALYTICAL hemisphere")) {
      return respond({
        rewrittenText: "Analytical rewrite focusing on safeguards and tone.",
        directives: [
          { area: "structure", strength: 0.8, instruction: "Keep it to three numbered steps." },
        ],
        validation: {
          forbiddenHits: [],
          wordCountOk: true,
          artifactsOk: true,
          impliedReliabilityOk: true,
        },
        inferredConstraints: [
          { text: "Add governance reminder in every step.", confidence: 0.74 },
        ],
        deltaSummary: "Analytical pass tightened scope and reiterated safeguards.",
      });
    }

    if (systemPrompt.includes("MODERATOR between the Analytical and Creative hemispheres")) {
      return respond({
        moderatedPrompt:
          "Rephrase the plan for executives. Keep three steps. Highlight governance checkpoints in each step.",
        moderatorSummary: "Moderator constrained Creative to formal executive tone with guardrails.",
        confidence: 0.91,
        needsUserClarification: false,
        userQuestion: null,
      });
    }

    if (systemPrompt.includes("You are the CREATIVE hemisphere")) {
      return respond({
        rewrittenText:
          "Creative polish: a three-step migration narrative with executive-ready tone and embedded governance notes.",
        deltaSummary: "Creative pass improved clarity and transition language.",
      });
    }

    if (systemPrompt.includes("cd\\ai narrative") || systemPrompt.includes("canonical trace")) {
      return respond("Narrative summary: workflow completed with all safeguards intact.");
    }

    // Default fallback keeps pipeline moving but surfaces content for debugging.
    const fallbackContent = needsJson
      ? {
          rewrittenText: userPrompt || "Harness stub output",
          deltaSummary: "Stub fallback.",
        }
      : userPrompt || "Harness stub output";
    return respond(fallbackContent);
  };

  return () => {
    global.fetch = previousFetch;
  };
}

module.exports = {
  installMockOpenAIStub,
};
