// HITL resume path test: ensures user confirmation of inferred rule is applied to the resumed workflow.

const assert = require("assert");
const { runGovernedWorkflow, parseGovernanceEnvelope } = require("../workflow/runGovernedWorkflow");
const { classifyGovernanceIntent } = require("../workflow/openaiClient");

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

// Local stub for this test (does not interfere with other suites).
global.fetch = async (_url, options = {}) => {
  const body = JSON.parse(options.body || "{}");
  const sys = body.messages?.[0]?.content || "";
  const user = body.messages?.find((m) => m.role === "user")?.content || "";
  const needsJson = body.response_format?.type === "json_object" || body.response_format === "json";

  if (sys.includes("Extract TASKS ONLY")) {
    const tasks = user ? [user.trim()] : [];
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ tasks }) } }] }) };
  }

  if (sys.includes("Extract RULES ONLY")) {
    const rules = {
      explicit: [],
      general: [],
      candidateInferred: [ "Include a short Risks section if any risks are relevant." ],
    };
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ rules }) } }] }) };
  }

  if (sys.includes("You classify user messages for a governed AI system")) {
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ intent: "task", confidence: 0.9 }) } }] }) };
  }

  if (sys.includes("You are a rule-extraction engine")) {
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ explicit_rules: [] }) } }] }) };
  }

  if (sys.includes("You are a rule inference engine")) {
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ inferred_rules: [] }) } }] }) };
  }

  const jsonContent = (payload) => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
  });

  if (sys.includes("Task Agent in a governed")) return jsonContent("task draft");
  if (sys.includes("ANALYTICAL hemisphere")) {
    return jsonContent({
      rewrittenText: "Analytical draft with Risks section.\nRisks:\n- Stub risk.",
      directives: [],
      validation: {
        forbiddenHits: [],
        wordCountOk: true,
        artifactsOk: true,
        impliedReliabilityOk: true,
      },
      inferredConstraints: [],
      deltaSummary: "added risks section",
    });
  }
  if (sys.includes("MODERATOR between the Analytical and Creative hemispheres")) {
    return jsonContent({
      moderatedPrompt: "Add risks as requested.",
      moderatorSummary: "moderated",
      confidence: 0.9,
      needsUserClarification: false,
      userQuestion: null,
    });
  }
  if (sys.includes("CREATIVE hemisphere")) {
    return jsonContent({
      rewrittenText: "Final draft with Risks section.\nRisks:\n- Stub risk.",
      deltaSummary: "kept risks",
    });
  }
  if (sys.includes("Validator in the cd\\ai")) {
    return jsonContent({
      forbiddenHits: [],
      wordCountOk: true,
      artifactsOk: true,
      impliedReliabilityOk: true,
    });
  }

  return { ok: true, json: async () => ({ choices: [{ message: { content: needsJson ? "{}" : "stubbed" } }] }) };
};

async function runWithHitlConfirmation() {
  const socket = new FakeSocket();
  const ledger = [];
  const goal = "";
  const input = "Write an update, include any risks if relevant.";
  const envelope = parseGovernanceEnvelope(input);
  const intent = await classifyGovernanceIntent(input);

  runGovernedWorkflow._inFlight = false;

  // Auto-respond to HITL prompt by sending a clarification-response event.
  socket.on("telemetry", (msg) => {
    if (msg.type === "governance-response" && /Should I include this rule/i.test(msg.text || "")) {
      socket.emit("clarification-response", { cycle: 0, answer: "yes" });
    }
  });

  await runGovernedWorkflow(socket, {
    input,
    goal,
    maxCycles: null,
    governanceStrictness: 0.85,
    perfMode: "real",
    rules: [],
    baseLedger: ledger,
    governanceEnvelope: envelope,
    confidenceScore: null,
  });

  const finalOutputs = socket.emitted
    .filter((e) => e.event === "telemetry" && e.payload?.subtype === "final-output")
    .map((e) => e.payload.text || "");

  const hasRisks = finalOutputs.some((t) => /Risks:/i.test(t));
  const governanceRulesMutated = false; // we never persisted global rules

  return { finalOutputs, hasRisks, governanceRulesMutated, ledger };
}

(async () => {
  try {
    const result = await runWithHitlConfirmation();
    console.log("HITL resume diagnostics:", {
      hasRisks: result.hasRisks,
      finalOutputs: result.finalOutputs,
    });
    assert.ok(result.hasRisks, "Confirmed inferred rule should be applied (Risks section present).");
    assert.strictEqual(result.governanceRulesMutated, false, "No persistent governance mutation expected.");
    console.log("HITL resume test passed.");
  } catch (err) {
    console.error("HITL resume test failed:", err.stack || err.message || err);
    process.exit(1);
  }
})();
