process.env.ALLOW_OPENAI_STUB = "1";
process.env.NODE_ENV = process.env.NODE_ENV || "test";

const assert = require("assert");
const { runGovernedWorkflow, resumeFromClarification } = require("../workflow/runGovernedWorkflow");

class FakeSocket {
  constructor(id = "suiteE") {
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

global.fetch = async (_url, options = {}) => {
  const body = JSON.parse(options.body || "{}");
  const sys = body.messages?.[0]?.content || "";
  const user = body.messages?.find((m) => m.role === "user")?.content || "";
  const needsJson = body.response_format?.type === "json_object" || body.response_format === "json";
  const toJsonContent = (payload) => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: typeof payload === "string" ? payload : JSON.stringify(payload) } }],
    }),
  });

  if (sys.includes("Extract TASKS ONLY")) {
    return toJsonContent({ tasks: user ? [user.trim()] : [] });
  }

  if (sys.includes("Extract RULES ONLY")) {
    return toJsonContent({ rules: { explicit: [], general: [], candidateInferred: [] } });
  }

  if (sys.includes("You classify user messages for a governed AI system")) {
    return toJsonContent({ intent: "task", confidence: 0.9 });
  }

  if (sys.includes("Task Agent in a governed")) return toJsonContent("task draft");

  if (sys.includes("ANALYTICAL hemisphere")) {
    return toJsonContent({
      rewrittenText: "Analytical compliance draft",
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
    return toJsonContent({
      moderatedPrompt: "Clarify before approving",
      moderatorSummary: "needs clarification",
      confidence: 0.4,
      needsUserClarification: true,
      userQuestion: "Confirm approval boundaries.",
    });
  }

  if (sys.includes("CREATIVE hemisphere")) {
    return toJsonContent({
      rewrittenText: "Creative approval draft",
      deltaSummary: "creative",
    });
  }

  if (sys.includes("Validator in the cd\\ai")) {
    return toJsonContent({
      forbiddenHits: [],
      wordCountOk: true,
      artifactsOk: true,
      impliedReliabilityOk: true,
    });
  }

  return toJsonContent(needsJson ? {} : "stubbed");
};

const REQUIRED_CHECKPOINT_FIELDS = [
  "requestType",
  "grammar",
  "rawRules",
  "normalizedRules",
  "constraints",
  "constraintSummary",
  "strictness",
  "envelope",
  "governanceDecision",
  "governanceDecisionDetail",
  "canonicalTrace",
];

const REQUIRED_PRE_TELEMETRY = [
  "v1.1-grammar",
  "v1.1-constraint-normalization",
  "v1.1-constraint-algebra",
  "v1.1-governance-matrix",
  "v1.1-output-shaping",
  "v1.1-validation",
  "mcp-clarification-checkpoint-created",
];

const REQUIRED_RESUME_TELEMETRY = [
  "clarification-accepted",
  "v1.1-output-shaping",
  "v1.1-validation",
  "final-output",
  "mcp-clarification-checkpoint-restored",
];

function sanitizeTrace(trace) {
  if (!trace) return trace;
  const clone = JSON.parse(JSON.stringify(trace));
  delete clone.requestId;
  delete clone.sessionId;
  return clone;
}

async function runIteration(iteration) {
  const socket = new FakeSocket(`suiteE-${iteration}`);
  runGovernedWorkflow._inFlight = false;
  const runResult = await runGovernedWorkflow(socket, {
    input: "approve this",
    rules: [{ text: "Confirm before any approval.", origin: "user" }],
    governanceStrictness: 0.95,
    perfMode: "real",
    requiresGovernedOutput: true,
    sessionId: `sess-${iteration}`,
    runId: `run-${iteration}`,
  });

  assert(runResult?.paused, "Expected workflow to pause for clarification.");
  const checkpoint = runResult.context || {};
  const preEvents = socket.emitted.slice();

  const clarificationEvent = preEvents.find((e) => e.event === "governance-clarification");
  assert(clarificationEvent, "governance-clarification event missing.");
  const prematureOutputs = preEvents.some(
    (e) => e.event === "telemetry" && e.payload?.subtype === "final-output"
  );
  const prematureWorkflowFinished = preEvents.some((e) => e.event === "workflow-finished");
  assert(!prematureOutputs, "final-output emitted before clarification resolution.");
  assert(!prematureWorkflowFinished, "workflow-finished emitted before clarification resolution.");

  REQUIRED_CHECKPOINT_FIELDS.forEach((field) => {
    assert(
      checkpoint[field] !== undefined && checkpoint[field] !== null,
      `Checkpoint missing required field ${field}.`
    );
  });
  assert.deepStrictEqual(
    checkpoint.canonicalTrace,
    checkpoint.cycleState?.canonicalTrace,
    "Canonical trace mismatch between checkpoint root and cycleState."
  );

  const preTelemetrySubtypes = preEvents
    .filter((e) => e.event === "telemetry")
    .map((e) => e.payload?.subtype);
  REQUIRED_PRE_TELEMETRY.forEach((eventName) => {
    assert(
      preTelemetrySubtypes.includes(eventName),
      `Missing telemetry event ${eventName} before pause.`
    );
  });

  const ledgerRef = checkpoint.ledger || [];
  const preTelemetryLength = preEvents.length;

  await resumeFromClarification(
    socket,
    checkpoint,
    "yes, proceed with the safer alternative (document-only)."
  );

  const postEvents = socket.emitted.slice(preTelemetryLength);
  const resumeTelemetrySubtypes = postEvents
    .filter((e) => e.event === "telemetry")
    .map((e) => e.payload?.subtype);
  REQUIRED_RESUME_TELEMETRY.forEach((eventName) => {
    assert(
      resumeTelemetrySubtypes.includes(eventName),
      `Missing telemetry event ${eventName} after resume.`
    );
  });

  const clarificationAccepted = postEvents.some(
    (e) => e.event === "clarification-accepted" || e.payload?.subtype === "clarification-accepted"
  );
  assert(clarificationAccepted, "clarification-accepted event missing after resume.");

  const finalOutputEvent = postEvents.find(
    (e) => e.event === "telemetry" && e.payload?.subtype === "final-output"
  );
  assert(finalOutputEvent, "Final output telemetry missing after resume.");
  const finalText = finalOutputEvent.payload?.data?.text || finalOutputEvent.payload?.text || "";
  assert(
    /\[Governance Notice:/i.test(finalText),
    "Final output missing strictness-aware safety notice."
  );

  const narrativeText = finalOutputEvent.payload?.data?.narrative || finalOutputEvent.payload?.narrative || "";
  assert(
    /\[Governance Summary\]/i.test(narrativeText || ""),
    "Narrative missing governance summary."
  );

  assert(
    Array.isArray(ledgerRef) && ledgerRef.slice(-3).map((item) => item.stage).join(">") === "Creative>Moderator-2>Validator",
    "Resume path did not follow C→M2→V."
  );

  return {
    finalText,
    narrativeText,
    canonicalTrace: sanitizeTrace(checkpoint.canonicalTrace),
    telemetry: socket.emitted
      .filter((e) => e.event === "telemetry")
      .map((e) => e.payload?.subtype || ""),
  };
}

(async () => {
  try {
    const iterations = [];
    for (let i = 1; i <= 3; i++) {
      iterations.push(await runIteration(i));
    }

    const baseline = iterations[0];
    iterations.slice(1).forEach((iter, idx) => {
      assert.strictEqual(iter.finalText, baseline.finalText, `Final text mismatch on iteration ${idx + 2}.`);
      assert.strictEqual(iter.narrativeText, baseline.narrativeText, `Narrative mismatch on iteration ${idx + 2}.`);
      assert.deepStrictEqual(
        iter.canonicalTrace,
        baseline.canonicalTrace,
        `Canonical trace mismatch on iteration ${idx + 2}.`
      );
      assert.deepStrictEqual(
        iter.telemetry,
        baseline.telemetry,
        `Telemetry sequence mismatch on iteration ${idx + 2}.`
      );
    });

    console.log("Test Suite E passed.");
  } catch (err) {
    console.error("Test Suite E failed:", err.stack || err.message || err);
    process.exit(1);
  }
})();
