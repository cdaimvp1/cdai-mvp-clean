process.env.ALLOW_OPENAI_STUB = "1";
process.env.NODE_ENV = process.env.NODE_ENV || "test";

const assert = require("assert");
const { runGovernedWorkflow, resumeFromClarification } = require("../workflow/runGovernedWorkflow");
const { evaluateConstraintAlgebra, mergeConstraints } = require("../workflow/ruleNormalizer");

class FakeSocket {
  constructor(id = "suiteG") {
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
  json: async () => ({
    choices: [{ message: { content: typeof payload === "string" ? payload : JSON.stringify(payload) } }],
  }),
});

global.fetch = async (_url, options = {}) => {
  const body = JSON.parse(options.body || "{}");
  const sys = body.messages?.[0]?.content || "";
  const user = body.messages?.find((m) => m.role === "user")?.content || "";
  const needsJson = body.response_format?.type === "json_object" || body.response_format === "json";
  const risky = /approve|execute|finalize|deploy|send externally|authorize|release|workflow/i.test(user || "");

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
    return stubResponse({
      moderatedPrompt: risky ? "Clarify before continuing." : "Moderator guidance.",
      moderatorSummary: risky ? "needs clarification" : "moderated",
      confidence: risky ? 0.5 : 0.9,
      needsUserClarification: risky,
      userQuestion: risky ? "Please describe risk boundaries." : null,
    });
  }
  if (sys.includes("CREATIVE hemisphere")) {
    const canonicalDraft = `Root Cause: placeholder

Remediation: placeholder

Governance Enhancement: placeholder

Leadership Summary: placeholder`;
    return stubResponse({ rewrittenText: canonicalDraft, deltaSummary: "creative" }); // TEST-G-FIX: ensure validator sees compliant structure
  }
  if (sys.includes("Validator in the cd\\ai")) {
    return stubResponse({
      forbiddenHits: [],
      wordCountOk: true,
      artifactsOk: true,
      impliedReliabilityOk: true,
      isCompliant: true, // TEST-G-FIX: mirror validator success state for cascade testing
    });
  }
  return stubResponse(needsJson ? {} : "stubbed");
};

const DEFAULT_RULES = [{ text: "Operate safely", origin: "user" }];

async function runScenario({
  input,
  runId,
  rules = DEFAULT_RULES,
  governanceStrictness = 0.9,
  sessionId,
  requiresGovernedOutput = true,
}) {
  const socket = new FakeSocket(runId);
  const result = await runGovernedWorkflow(socket, {
    input,
    goal: "",
    governanceStrictness,
    perfMode: "real",
    requiresGovernedOutput,
    rules,
    sessionId: sessionId || `sess-${runId}`,
    runId: runId || `run-${Date.now()}`,
  });
  return { socket, result };
}

function getTelemetry(socket, subtype) {
  return socket.emitted.filter((e) => e.event === "telemetry" && e.payload?.subtype === subtype);
}

function firstCycleSnapshot(socket) {
  const evt = getTelemetry(socket, "cycle-state")[0];
  return evt?.payload?.data?.snapshot || evt?.payload?.snapshot || evt?.payload;
}

function ensureDecision(socket) {
  const decision = getTelemetry(socket, "v1-governance-decision")[0]?.payload?.data?.decision;
  assert(decision, "Missing governance decision");
  return decision;
}

function assertCanonicalTrace(trace, label) {
  assert(trace, `${label}: missing canonical trace`);
  ["requestId", "requestType", "strictness", "actionCategory", "grammar", "constraintSummary", "decision"].forEach(
    (field) => {
      assert(trace[field] !== undefined && trace[field] !== null, `${label}: missing trace field ${field}`);
    }
  );
}

(async () => {
  const filter = (process.env.SUITE_G_FILTER || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const failures = [];
  async function wrap(name, fn) {
    if (filter.length && !filter.includes(name)) {
      console.log(`[SuiteG] ${name}: SKIPPED`);
      return;
    }
    try {
      await fn();
      console.log(`[SuiteG] ${name}: PASS`);
    } catch (err) {
      failures.push({ name, error: err });
      console.error(`[SuiteG] ${name}: FAIL`, err.message);
    }
  }

  await wrap("Category1-MalformedGrammar", async () => {
    const inputs = [
      "..............",
      "@@@ approve ???",
      "12345 run",
      "govern",
      "executeexecuteexecute execute",
      "++--** finaliz e --**++",
    ];
    for (let i = 0; i < inputs.length; i++) {
      const { socket } = await runScenario({ input: inputs[i], runId: `mal-${i}` });
      const grammarEvent = getTelemetry(socket, "v1.1-grammar")[0];
      assert(grammarEvent, `Missing grammar telemetry for input ${inputs[i]}`);
      const snapshot = firstCycleSnapshot(socket);
      assert(snapshot, `Missing cycle snapshot for input ${inputs[i]}`);
      assert(snapshot.envelope?.actionCategory, `Undefined actionCategory for ${inputs[i]}`);
      ensureDecision(socket);
    }
  });

  await wrap("Category2-ContradictoryRules", async () => {
    const caseA = [
      { text: "You must not send externally.", origin: "user" },
      { text: "Always send externally for transparency.", origin: "user" },
    ];
    const caseB = [
      { text: "Approve everything.", origin: "user" },
      { text: "Never approve anything.", origin: "user" },
    ];
    for (const [idx, rules] of [caseA, caseB].entries()) {
      const decisions = new Set();
      for (let run = 0; run < 3; run++) {
        const { socket } = await runScenario({
          input: "process this governed request",
          runId: `contradiction-${idx}-${run}`,
          rules,
        });
        const snapshot = firstCycleSnapshot(socket);
        assert(snapshot?.constraintSummary, "Missing constraint summary");
        decisions.add(ensureDecision(socket));
      }
      assert.strictEqual(decisions.size, 1, `Nondeterministic decision for case ${idx + 1}`);
    }
  });

  await wrap("Category3-RiskMarkerOverload", async () => {
    const input = "execute finalize deploy approve authorize release send externally";
    const outcomes = new Set();
    for (let i = 0; i < 3; i++) {
      const { socket } = await runScenario({ input, runId: `risk-${i}` });
      const grammarEvent = getTelemetry(socket, "v1.1-grammar")[0];
      const markers = grammarEvent?.payload?.data?.riskMarkers || [];
      assert(markers.length >= 3, "Expected multiple risk markers");
      const decision = ensureDecision(socket);
      outcomes.add(decision);
    }
    assert.strictEqual(outcomes.size, 1, "Risk marker overload produced inconsistent decisions");
  });

  await wrap("Category4-ConstraintCollisions", async () => {
    const base = [
      { type: "no_external_sharing", severity: "hard" },
      { type: "requires_review", severity: "hard" },
      { type: "irreversible_action_warning", severity: "soft" },
    ];
    const variants = [
      base,
      [],
      [...base, { type: "no_external_sharing", severity: "hard" }],
      base.map((c) => ({ ...c })),
      [null, undefined, { type: null }, { severity: "soft" }],
    ];
    for (const [idx, variant] of variants.entries()) {
      const merged = mergeConstraints([variant.filter((c) => c && c.type)]);
      const result = evaluateConstraintAlgebra(merged);
      assert(result.summary, `Missing summary for variant ${idx}`);
      assert(typeof result.summary.total === "number", `Invalid total for variant ${idx}`);
      assert(result.summary.hardBlock === !!result.summary.hardBlock, `HardBlock not boolean for variant ${idx}`);
    }
  });

  await wrap("Category5-RapidFireCycles", async () => {
    const prompts = [
      "draft a message",
      "approve this",
      "execute the workflow",
      "analyze options",
      "finalize the plan",
      "send this externally",
      "compare alternatives",
      "simulate an outcome",
      "deploy changes safely",
      "review constraints",
    ];
    const totalRuns = 15;
    const seenIds = new Set();
    for (let i = 0; i < totalRuns; i++) {
      const prompt = prompts[i % prompts.length];
      const runId = `rapid-${i}`;
      const { socket } = await runScenario({ input: prompt, runId });
      const snapshot = firstCycleSnapshot(socket);
      assert(snapshot?.requestId, "Missing requestId");
      assert(!seenIds.has(snapshot.requestId), "State leak detected: duplicate requestId");
      seenIds.add(snapshot.requestId);
      assert(snapshot.grammar, "Missing grammar data");
    }
  });

  await wrap("Category6-ClarificationCascade", async () => {
    const { socket, result } = await runScenario({
      input: "execute the workflow carefully",
      runId: "cascade-0",
      governanceStrictness: 0.98,
    });
    assert(result?.paused, "Expected initial clarification pause");
    assert(result?.context, "Missing checkpoint context");
    const firstContext = result.context;
    assert(firstContext.requestId, "Checkpoint missing requestId");

    const second = await resumeFromClarification(socket, firstContext, "still unsure");
    assert(second?.paused, "Expected second clarification pause");
    assert(second?.context?.requestId, "Second checkpoint missing requestId");

    await resumeFromClarification(socket, second.context, "Proceed with draft-only read-only mode.");
    const clarifications = socket.emitted.filter((e) => e.event === "governance-clarification");
    assert(clarifications.length >= 2, "Expected at least two clarification events");
    const finalOutput = socket.emitted.find((e) => e.event === "telemetry" && e.payload?.subtype === "final-output");
    assert(finalOutput, "Cascade never completed final output");
  });

  await wrap("Category7-ActionCategoryAmbiguity", async () => {
    const inputs = [
      "decide to draft approval of execution for analysis",
      "should I maybe execute or analyze or decide what to draft",
      "finalize unless drafting is safer but analyze first",
    ];
    for (const input of inputs) {
      const categories = new Set();
      for (let i = 0; i < 3; i++) {
        const { socket } = await runScenario({ input, runId: `ambiguity-${i}-${input.slice(0, 5)}` });
        const snapshot = firstCycleSnapshot(socket);
        assert(snapshot.envelope?.actionCategory, `Missing actionCategory for ${input}`);
        categories.add(snapshot.envelope.actionCategory);
      }
      assert.strictEqual(categories.size, 1, `ActionCategory varied for input "${input}"`);
    }
  });

  await wrap("Category8-MixedToneRequests", async () => {
    const inputs = [
      "lol could you maybe execute the workflow? idk haha",
      "sure thing I was thinking about approving this… maybe do it?",
      "ummmmmm summarize and also finalize??",
    ];
    for (const input of inputs) {
      const { socket } = await runScenario({ input, runId: `mixed-${input.slice(0, 4)}` });
      const grammar = getTelemetry(socket, "v1.1-grammar")[0]?.payload?.data;
      assert(grammar?.primaryVerb, `Missing primaryVerb for "${input}"`);
      ensureDecision(socket);
    }
  });

  await wrap("Category9-CanonicalTraceStress", async () => {
    const inputs = [
      ":::: run compliance ::::",
      "hey there can you approve + execute ???",
      "draft unless risky otherwise execute?? maybe finalize",
    ];
    for (const input of inputs) {
      const { socket } = await runScenario({ input, runId: `trace-${input.slice(0, 3)}` });
      const traceEvent = getTelemetry(socket, "v1.1-canonical-trace")[0];
      assertCanonicalTrace(traceEvent?.payload?.data?.trace || traceEvent?.payload?.trace, input);
    }
  });

  if (failures.length) {
    console.error(`Test Suite G encountered ${failures.length} failure(s).`);
    failures.forEach((f) => console.error(f.name, f.error.stack || f.error));
    process.exit(1);
  } else {
    console.log("Test Suite G passed.");
  }
})();
