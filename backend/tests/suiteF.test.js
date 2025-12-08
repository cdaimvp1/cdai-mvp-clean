process.env.ALLOW_OPENAI_STUB = "1";
process.env.NODE_ENV = process.env.NODE_ENV || "test";

const assert = require("assert");
const { runGovernedWorkflow, resumeFromClarification } = require("../workflow/runGovernedWorkflow");

class FakeSocket {
  constructor(id = "suiteF") {
    this.id = id;
    this.emitted = [];
    this.listeners = {};
  }

  emit(event, payload) {
    this.emitted.push({ event, payload });
    (this.listeners[event] || []).forEach((fn) => fn(payload));
  }

  on(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }
}

const stubResponse = (payload) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content: typeof payload === "string" ? payload : JSON.stringify(payload) } }] }),
});

global.fetch = async (_url, options = {}) => {
  const body = JSON.parse(options.body || "{}");
  const sys = body.messages?.[0]?.content || "";
  const user = body.messages?.find((m) => m.role === "user")?.content || "";
  const needsJson = body.response_format?.type === "json_object" || body.response_format === "json";

  if (sys.includes("Extract TASKS ONLY")) {
    return stubResponse({ tasks: user ? [user.trim()] : [] });
  }
  if (sys.includes("Extract RULES ONLY")) {
    return stubResponse({ rules: { explicit: [], general: [], candidateInferred: [] } });
  }
  if (sys.includes("You classify user messages for a governed AI system")) {
    return stubResponse({ intent: "task", confidence: 0.9 });
  }
  if (sys.includes("Task Agent in a governed")) return stubResponse("task draft");
  if (sys.includes("ANALYTICAL hemisphere")) {
    return stubResponse({
      rewrittenText: "Analytical governed draft",
      directives: [],
      validation: {
        forbiddenHits: [],
        wordCountOk: true,
        artifactsOk: true,
        impliedReliabilityOk: true,
      },
      inferredConstraints: [],
      deltaSummary: "analytical",
    });
  }
  if (sys.includes("MODERATOR between the Analytical and Creative hemispheres")) {
    const clarify = user && /approve this|execute the data export safely/i.test(user);
    return stubResponse({
      moderatedPrompt: clarify ? "Clarify before continuing." : "Moderator guidance.",
      moderatorSummary: clarify ? "needs clarification" : "moderated",
      confidence: clarify ? 0.4 : 0.9,
      needsUserClarification: clarify,
      userQuestion: clarify ? "Confirm approval scope." : null,
    });
  }
  if (sys.includes("CREATIVE hemisphere")) {
    return stubResponse({ rewrittenText: "Creative governed draft", deltaSummary: "creative" });
  }
  if (sys.includes("Validator in the cd\\ai")) {
    return stubResponse({
      forbiddenHits: [],
      wordCountOk: true,
      artifactsOk: true,
      impliedReliabilityOk: true,
    });
  }
  return stubResponse(needsJson ? {} : "stubbed");
};

function sanitizeTrace(trace) {
  if (!trace) return trace;
  const clone = JSON.parse(JSON.stringify(trace));
  delete clone.requestId;
  delete clone.sessionId;
  delete clone.resumeCount;
  delete clone.lastResumeAnswer;
  if (clone.steps) delete clone.steps.resume; // TEST-F-FIX: ignore resume marker for deterministic comparison
  return clone;
}

// TEST-F-FIX: normalize grammar telemetry for deterministic comparisons
function normalizeGrammarPayload(data) {
  if (!data) return null;
  const clone = JSON.parse(JSON.stringify(data));
  delete clone.requestId;
  delete clone.sessionId;
  delete clone.event;
  return clone;
}

// TEST-F-FIX: sanitize cycle-state snapshots for deterministic comparisons
function normalizeSnapshotForDeterminism(snapshot) {
  if (!snapshot) return {};
  const clone = JSON.parse(JSON.stringify(snapshot));
  clone.requestId = "deterministic";
  if (clone.canonicalTrace) {
    clone.canonicalTrace.requestId = "deterministic";
  }
  if (clone.envelope?.metadata) {
    delete clone.envelope.metadata.timestamp; // TEST-F-FIX: strip run-specific envelope metadata
  }
  return clone;
}

async function runScenario({ input, rules = [{ text: "Operate safely", origin: "user" }], runId, sessionId }) {
  const socket = new FakeSocket(runId);
  runGovernedWorkflow._inFlight = false;
  const result = await runGovernedWorkflow(socket, {
    input,
    goal: "",
    maxCycles: null,
    governanceStrictness: 0.9,
    perfMode: "real",
    requiresGovernedOutput: true,
    rules,
    sessionId: sessionId || `sess-${runId}`,
    runId: runId || `run-${Date.now()}`,
  });
  return { socket, result };
}

function getTelemetry(socket, subtype) {
  return socket.emitted.filter((e) => e.event === "telemetry" && e.payload?.subtype === subtype);
}

function collectCycleSnapshots(socket) {
  return socket.emitted
    .filter((e) => e.event === "telemetry" && e.payload?.subtype === "cycle-state")
    .map((e) => e.payload?.data || {});
}

const REQUIRED_FIELDS = [
  "requestId",
  "requestType",
  "grammar",
  "normalizedRules",
  "constraints",
  "constraintSummary",
  "strictness",
  "envelope",
  "governanceDecision",
  "governanceDecisionDetail",
  "canonicalTrace",
];

function assertSnapshot(snapshot, label) {
  REQUIRED_FIELDS.forEach((field) => {
    const value = snapshot[field];
    assert(value !== undefined && value !== null, `${label}: missing ${field}`);
  });
  assert(snapshot.envelope?.actionCategory, `${label}: missing envelope.actionCategory`);
}

function compareSnapshots(base, candidate, label) {
  REQUIRED_FIELDS.forEach((field) => {
    assert.deepStrictEqual(candidate[field], base[field], `${label}: field mismatch for ${field}`);
  });
  assert.strictEqual(candidate.envelope.actionCategory, base.envelope.actionCategory, `${label}: actionCategory mismatch`);
}

function ensureOrder(sequence, required) {
  let idx = -1;
  required.forEach((item) => {
    const next = sequence.indexOf(item, idx + 1);
    assert(next !== -1, `Telemetry missing or out of order: ${item}`);
    idx = next;
  });
}

(async () => {
  const failures = [];

  async function wrap(name, fn) {
    try {
      await fn();
      console.log(`[SuiteF] ${name}: PASS`);
    } catch (err) {
      failures.push({ name, error: err });
      console.error(`[SuiteF] ${name}: FAIL`, err.message);
    }
  }

  await wrap("Part1-CycleStateInvariants", async () => {
    const prompts = [
      "draft a compliant memo",
      "approve this",
      "execute the data export safely",
      "draft a risk summary",
      "prepare governance recap",
      "outline mitigation plan",
      "design rollout update",
      "craft compliance summary",
      "write escalation note",
      "prepare audit response",
    ];
    for (let i = 0; i < prompts.length; i++) {
      const { socket } = await runScenario({ input: prompts[i], runId: `inv-${i}` });
      const snapshots = collectCycleSnapshots(socket);
      assert(snapshots.length > 0, "No cycle-state telemetry emitted.");
      snapshots.forEach((snap, idx) => assertSnapshot(snap.snapshot || snap, `Prompt ${i} snapshot ${idx}`));
    }
  });

  await wrap("Part2-HemispherePropagation", async () => {
    const { socket } = await runScenario({ input: "draft a compliant memo", runId: "prop-0" });
    const snapshots = collectCycleSnapshots(socket);
    const byStage = {};
    snapshots.forEach((snap) => {
      const key = `${snap.stage}-${snap.phase}`;
      byStage[key] = snap.snapshot || snap;
    });
    const base = byStage["Analytical-entry"];
    assert(base, "Missing Analytical-entry snapshot");
    Object.entries(byStage).forEach(([label, snapshot]) => {
      assertSnapshot(snapshot, label);
      compareSnapshots(base, snapshot, label);
    });
  });

  await wrap("Part3-CanonicalTraceConsistency", async () => {
    const { socket } = await runScenario({ input: "draft a compliant memo", runId: "trace-0" });
    const traces = getTelemetry(socket, "v1.1-canonical-trace").map((e) => sanitizeTrace(e.payload?.data?.trace || e.payload?.trace));
    assert(traces.length >= 2, "Expected at least two canonical trace emissions.");
    const first = traces[0];
    const last = traces[traces.length - 1];
    REQUIRED_FIELDS.filter((f) => f !== "normalizedRules").forEach((field) => {
      assert.deepStrictEqual(last[field], first[field], `Canonical trace mismatch for ${field}`);
    });
  });

  await wrap("Part4-ClarificationTraceStability", async () => {
    const { socket, result } = await runScenario({ input: "approve this", runId: "clarify-0" });
    assert(result.paused, "Request should pause for clarification");
    const checkpointTrace = sanitizeTrace(result.context?.canonicalTrace);
    assertSnapshot(result.context, "Checkpoint context");
    const preTrace = sanitizeTrace(result.context?.canonicalTrace);
    await resumeFromClarification(socket, result.context, "yes, proceed with the safer alternative");
    const traces = getTelemetry(socket, "v1.1-canonical-trace").map((e) => ({ resumed: e.payload?.data?.resumed, trace: sanitizeTrace(e.payload?.data?.trace || e.payload?.trace) }));
    const resumeTrace = traces.find((t) => t.resumed)?.trace;
    assert(resumeTrace, "Missing resumed canonical trace emission");
    assert.deepStrictEqual(resumeTrace, preTrace, "Resume trace diverged from checkpoint trace");
    assert.deepStrictEqual(preTrace, checkpointTrace, "Checkpoint trace mismatch");
  });

  await wrap("Part5-Determinism", async () => {
    const prompts = ["draft a compliant memo", "approve the request", "execute the data export safely"];
    for (const prompt of prompts) {
      const baseline = { grammar: null, snapshot: null, trace: null };
      for (let i = 0; i < 5; i++) {
        const runId = `${prompt.replace(/\s+/g, "-")}-det-${i}`;
        const { socket } = await runScenario({ input: prompt, runId });
        const grammarEvent = getTelemetry(socket, "v1.1-grammar")[0];
        // TEST-F-FIX: sanitize per-run metadata before comparisons
        const grammarData = normalizeGrammarPayload(grammarEvent?.payload?.data);
        const snapshotEvent = collectCycleSnapshots(socket)[0];
        const snapshot = normalizeSnapshotForDeterminism(snapshotEvent?.snapshot || snapshotEvent);
        const trace = sanitizeTrace(getTelemetry(socket, "v1.1-canonical-trace")[0]?.payload?.data?.trace);
        if (i === 0) {
          baseline.grammar = grammarData;
          baseline.snapshot = snapshot;
          baseline.trace = trace;
        } else {
          assert.deepStrictEqual(grammarData, baseline.grammar, `Grammar mismatch on run ${i} for ${prompt}`);
          compareSnapshots(baseline.snapshot, snapshot, `${prompt} run ${i}`);
          assert.deepStrictEqual(trace, baseline.trace, `Canonical trace mismatch on run ${i} for ${prompt}`);
        }
      }
    }
  });

  await wrap("Part6-TelemetryOrder", async () => {
    const { socket } = await runScenario({ input: "draft a compliant memo", runId: "telemetry-0" });
    const order = socket.emitted
      .filter((e) => e.event === "telemetry")
      .map((e) => e.payload?.subtype)
      .filter(Boolean);
    const required = [
      "v1.1-grammar",
      "v1.1-constraint-normalization",
      "v1.1-constraint-algebra",
      "v1.1-governance-matrix",
      "v1.1-output-shaping",
      "v1.1-validation",
    ];
    ensureOrder(order, required);
    assert(order.includes("final-output"), "Missing final-output telemetry");
    assert(order.includes("workflow-finished"), "Missing workflow-finished telemetry");
  });

  if (failures.length) {
    console.error(`Test Suite F encountered ${failures.length} failure(s).`);
    failures.forEach((f) => console.error(f.name, f.error.stack || f.error));
    process.exit(1);
  } else {
    console.log("Test Suite F passed.");
  }
})();
