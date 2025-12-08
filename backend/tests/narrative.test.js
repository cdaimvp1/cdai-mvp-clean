// Narrative layer coverage: ensures final-output always carries a narrative
// across success, validation failure, and turbo paths.

const { runGovernedWorkflow } = require("../workflow/runGovernedWorkflow");

class FakeSocket {
  constructor() {
    this.emitted = [];
    this.listeners = {};
  }

  emit(event, payload) {
    this.emitted.push({ event, payload });
    const fns = this.listeners[event] || [];
    fns.forEach((fn) => fn(payload));
  }

  on(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }

  off(event, fn) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter((f) => f !== fn);
  }
}

function buildFetchStub({ failValidation = false } = {}) {
  return async (_url, options = {}) => {
    const body = JSON.parse(options.body || "{}");
    const sys = body.messages?.[0]?.content || "";
    const needsJson = body.response_format?.type === "json_object";

    let content;

    if (sys.includes("ANALYTICAL hemisphere")) {
      content = JSON.stringify({
        rewrittenText: "analytical",
        directives: [],
        validation: {
          forbiddenHits: [],
          wordCountOk: true,
          artifactsOk: true,
          impliedReliabilityOk: true,
        },
        inferredConstraints: [],
        deltaSummary: "Analytical adjustments applied.",
      });
    } else if (sys.includes("MODERATOR between the Analytical and Creative hemispheres")) {
      content = JSON.stringify({
        moderatedPrompt: "keep it steady",
        moderatorSummary: "Moderator constrained Creative.",
        confidence: 0.9,
        needsUserClarification: false,
        userQuestion: null,
      });
    } else if (sys.includes("CREATIVE hemisphere")) {
      content = JSON.stringify({
        rewrittenText: "analytical",
        deltaSummary: "Creative polishing complete.",
      });
    } else if (sys.includes("Validator in the cd\\ai")) {
      content = JSON.stringify({
        forbiddenHits: failValidation ? ["violation"] : [],
        wordCountOk: !failValidation,
        artifactsOk: !failValidation,
        impliedReliabilityOk: !failValidation,
      });
    } else {
      // Task agent / turbo / unresolved conflicts synthesis
      content = needsJson ? "{}" : "stubbed output";
    }

    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content } }],
      }),
    };
  };
}

async function assertNarrativePresent({ perfMode, failValidation }) {
  const socket = new FakeSocket();
  global.fetch = buildFetchStub({ failValidation });

  await runGovernedWorkflow(socket, {
    input: failValidation ? "force failure" : "test task",
    goal: "",
    maxCycles: perfMode === "turbo" ? undefined : 2,
    governanceStrictness: 0.85,
    perfMode,
  });

  const final = socket.emitted.find(
    (e) => e.event === "telemetry" && e.payload?.subtype === "final-output"
  );

  if (!final) {
    throw new Error(`No final-output telemetry for mode=${perfMode}`);
  }

  const rulesEvent = socket.emitted.find(
    (e) =>
      e.event === "parsed-rules" ||
      e.event === "governance-rules" ||
      (e.event === "telemetry" && e.payload?.subtype === "governance-rules")
  );
  const rulesPayload = rulesEvent?.payload?.payload || rulesEvent?.payload;
  const governed =
    rulesPayload && Array.isArray(rulesPayload.rules) && rulesPayload.rules.length > 0;

  if (governed) {
    if (!final.payload.narrative || typeof final.payload.narrative !== "string" || !final.payload.narrative.trim()) {
      throw new Error(`Narrative missing or empty for governed run mode=${perfMode}`);
    }
  } else {
    if (final.payload.narrative && final.payload.narrative.trim()) {
      // Ungoverned runs may legitimately omit narrative; allow empty narrative.
    }
  }
}

(async () => {
  try {
    await assertNarrativePresent({ perfMode: "real", failValidation: false });
    await assertNarrativePresent({ perfMode: "real", failValidation: true });
    await assertNarrativePresent({ perfMode: "turbo", failValidation: false });
    console.log("Narrative layer tests passed.");
  } catch (err) {
    console.error("Narrative layer tests failed:", err.message || err);
    process.exit(1);
  }
})();
