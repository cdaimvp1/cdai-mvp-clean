// Governance clarification flow: ensure moderator HITL emits clarification event and output halts.

const assert = require("assert");
const { runGovernedWorkflow, resumeFromClarification } = require("../workflow/runGovernedWorkflow");

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

// Local stubs for OpenAI calls to force a clarification branch.
global.fetch = async (_url, options = {}) => {
  const body = JSON.parse(options.body || "{}");
  const sys = body.messages?.[0]?.content || "";
  const user = body.messages?.find((m) => m.role === "user")?.content || "";
  const needsJson = body.response_format?.type === "json_object" || body.response_format === "json";

  const jsonContent = (payload) => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
  });

  if (sys.includes("Extract TASKS ONLY")) {
    const tasks = user ? [user.trim()] : [];
    return jsonContent({ tasks });
  }

  if (sys.includes("Extract RULES ONLY")) {
    return jsonContent({ rules: { explicit: [], general: [], candidateInferred: [] } });
  }

  if (sys.includes("You classify user messages for a governed AI system")) {
    return jsonContent({ intent: "task", confidence: 0.9 });
  }

  if (sys.includes("Task Agent in a governed")) {
    return jsonContent("task draft");
  }

  if (sys.includes("ANALYTICAL hemisphere")) {
    return jsonContent({
      rewrittenText: "Analytical draft",
      directives: [],
      validation: {
        forbiddenHits: [],
        wordCountOk: true,
        artifactsOk: true,
        impliedReliabilityOk: true,
      },
      inferredConstraints: [],
      deltaSummary: "noop",
    });
  }

  if (sys.includes("MODERATOR between the Analytical and Creative hemispheres")) {
    return jsonContent({
      moderatedPrompt: "Clarify before proceeding",
      moderatorSummary: "needs clarification",
      confidence: 0.4,
      needsUserClarification: true,
      userQuestion: "Please confirm the primary constraint.",
    });
  }

  if (sys.includes("CREATIVE hemisphere")) {
    return jsonContent({
      rewrittenText: "Creative draft",
      deltaSummary: "noop",
    });
  }

  if (needsJson) {
    return jsonContent({});
  }

  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content: "stub" } }] }),
  };
};

async function runClarificationScenario() {
  const socket = new FakeSocket();
  runGovernedWorkflow._inFlight = false;

  await runGovernedWorkflow(socket, {
    input: "Draft a memo but only after you ask me to confirm constraints.",
    rules: [{ text: "Confirm constraints before drafting", origin: "user" }],
    governanceStrictness: 0.85,
    perfMode: "real",
    requiresGovernedOutput: true,
  });

  return socket.emitted;
}

describe("Governance clarification flow", () => {
  it("emits governance-clarification and halts before final output", async () => {
    const events = await runClarificationScenario();
    const clarification = events.find((e) => e.event === "governance-clarification");
    assert(clarification, "Expected governance-clarification event");
    assert(
      clarification.payload?.payload?.question,
      "governance-clarification event should include a question"
    );

    const finalOutput = events.find(
      (e) => e.event === "telemetry" && e.payload?.subtype === "final-output"
    );
    assert(
      !finalOutput,
      "Final output should not be emitted before clarification is resolved"
    );
  });

  it("resumes after clarification and produces final output", async () => {
    const socket = new FakeSocket("sock-hitl-resume");
    runGovernedWorkflow._inFlight = false;
    const result = await runGovernedWorkflow(socket, {
      input: "Draft a memo but only after you ask me to confirm constraints.",
      rules: [{ text: "Confirm constraints before drafting", origin: "user" }],
      governanceStrictness: 0.85,
      perfMode: "real",
      requiresGovernedOutput: true,
      sessionId: "sess-hitl",
      runId: "run-hitl",
    });

    assert(result?.paused, "workflow should pause for clarification");
    await runGovernedWorkflow.resumeFromClarification(socket, result.context, "clarified");

    const finalOutput = socket.emitted.find(
      (e) => e.event === "telemetry" && e.payload?.subtype === "final-output"
    );
    assert(finalOutput, "expected final output after clarification resume");
  });
});
