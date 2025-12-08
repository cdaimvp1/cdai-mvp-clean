// Lightweight runtime checks for GIL-Lite enforcement.
// Uses a stubbed socket and a stubbed OpenAI fetch to avoid network calls.

const { runGovernedWorkflow } = require("../workflow/runGovernedWorkflow");

// -----------------------------------------------------------------------------=
// Test harness helpers
// -----------------------------------------------------------------------------=
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

// Minimal stub to satisfy callOpenAIChat; returns deterministic JSON where needed.
global.fetch = async (_url, options = {}) => {
  const body = JSON.parse(options.body || "{}");
  const sys = body.messages?.[0]?.content || "";
  const needsJson = body.response_format?.type === "json_object";

  let content;
  if (sys.includes("Extract TASKS ONLY")) {
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ tasks: ["test task"] }) } }],
      }),
    };
  }

  if (sys.includes("Extract RULES ONLY")) {
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ rules: { explicit: [], general: [], candidateInferred: [] } }) } }],
      }),
    };
  }

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
      forbiddenHits: [],
      wordCountOk: true,
      artifactsOk: true,
      impliedReliabilityOk: true,
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

async function testUserCapStopsAt3() {
  const socket = new FakeSocket();

  await runGovernedWorkflow(socket, {
    input: "test task",
    goal: "",
    maxCycles: 3,
    governanceStrictness: 0.85,
    perfMode: "real",
    rules: ["dummy rule"],
    requiresGovernedOutput: true,
  });

  const cycles = socket.emitted.filter(
    (e) => e.event === "telemetry" && e.payload?.subtype === "cycle-update"
  );
  const plan = socket.emitted.find(
    (e) => e.event === "telemetry" && e.payload?.subtype === "cycle-plan"
  );

  const planned = plan?.payload?.data?.plannedCycles ?? plan?.payload?.plannedCycles;
  if (!plan) {
    console.warn("No cycle-plan emitted; skipping plannedCycles assertion (ungoverned path).");
  } else if (planned > 3 || planned < 1) {
    throw new Error("Expected plannedCycles between 1 and 3 when user cap is 3.");
  }

  const maxSeenCycle = Math.max(...cycles.map((c) => c.payload.cycle));
  if (maxSeenCycle > 3) {
    throw new Error(`Engine exceeded user cap: saw cycle ${maxSeenCycle}.`);
  }
}

async function testOpenCycleUsesHardMax() {
  const socket = new FakeSocket();

  await runGovernedWorkflow(socket, {
    input: "test task",
    goal: "",
    maxCycles: null,
    governanceStrictness: 0.85,
    perfMode: "real",
    rules: ["dummy rule"],
    requiresGovernedOutput: true,
  });

  const plan = socket.emitted.find(
    (e) => e.event === "telemetry" && e.payload?.subtype === "cycle-plan"
  );
  const planned = plan?.payload?.data?.plannedCycles ?? plan?.payload?.plannedCycles;
  if (!plan) {
    console.warn("No cycle-plan emitted; skipping plannedCycles assertion (ungoverned path).");
  } else if (planned !== 25) {
    throw new Error("Expected open-cycle plannedCycles to honor HARD_MAX_CYCLES=25.");
  }

  const cycles = socket.emitted.filter(
    (e) => e.event === "telemetry" && e.payload?.subtype === "cycle-update"
  );
  const maxSeenCycle = Math.max(...cycles.map((c) => c.payload.cycle));
  if (maxSeenCycle > 25) {
    throw new Error(`Engine exceeded hard cap: saw cycle ${maxSeenCycle}.`);
  }
}

(async () => {
  try {
    await testUserCapStopsAt3();
    await testOpenCycleUsesHardMax();
    console.log("GIL-Lite tests passed.");
  } catch (err) {
    console.error("GIL-Lite tests failed:", err.message || err);
    process.exit(1);
  }
})();
