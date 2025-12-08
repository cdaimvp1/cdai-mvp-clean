process.env.ALLOW_OPENAI_STUB = "1";
process.env.NODE_ENV = process.env.NODE_ENV || "test";

const assert = require("assert");
const { runGovernedWorkflow, resumeFromClarification } = require("../workflow/runGovernedWorkflow");
const { DATA_SCOPE_MODES } = require("../workflow/governanceConstants");
const { handleDataScopeModeChange } = require("../workflow/dataScopeModeHandler");

class FakeSocket {
  constructor(id = "datascope-phase5") {
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

const BASE_RULE = { text: "Operate safely; document decisions.", origin: "user" };
const NO_PUBLIC_MIX_RULE = { text: "Do not integrate public data with internal content.", origin: "user" };
const CITATION_RULE = { text: "When using public/web data you must cite all public sources.", origin: "user" };
const PROVENANCE_RULE = { text: "Track provenance for all external/public content.", origin: "user" };
const NO_WEB_ACCESS_RULE = { text: "Do not use web data; stay in internal systems.", origin: "user" };

const llmState = {
  creativeOutput: "Creative governed draft",
  forceModeratorClarification: false,
  moderatorPredicate: null,
};

function resetLLMState() {
  llmState.creativeOutput = "Creative governed draft";
  llmState.forceModeratorClarification = false;
  llmState.moderatorPredicate = null;
}

function configureLLMState(overrides = {}) {
  resetLLMState();
  if (overrides.creativeOutput !== undefined) {
    llmState.creativeOutput = overrides.creativeOutput;
  }
  if (overrides.forceModeratorClarification !== undefined) {
    llmState.forceModeratorClarification = overrides.forceModeratorClarification;
  }
  if (typeof overrides.moderatorPredicate === "function") {
    llmState.moderatorPredicate = overrides.moderatorPredicate;
  }
}

const stubResponse = (payload) => ({
  ok: true,
  json: async () => ({
    choices: [
      {
        message: {
          content: typeof payload === "string" ? payload : JSON.stringify(payload),
        },
      },
    ],
  }),
});

global.fetch = async (_url, options = {}) => {
  const body = JSON.parse(options.body || "{}");
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const sys = messages[0]?.content || "";
  const user = messages.find((m) => m.role === "user")?.content || "";
  const needsJson = body.response_format?.type === "json_object" || body.response_format === "json";

  if (sys.includes("Extract TASKS ONLY")) {
    return stubResponse({ tasks: user ? [user.trim()] : [] });
  }
  if (sys.includes("Extract RULES ONLY")) {
    return stubResponse({ rules: { explicit: [], general: [], candidateInferred: [] } });
  }
  if (sys.includes("You classify user messages for a governed AI system")) {
    return stubResponse({ intent: "task", confidence: 0.92 });
  }
  if (sys.includes("Task Agent in a governed")) return stubResponse("task draft");
  if (sys.includes("ANALYTICAL hemisphere")) {
    return stubResponse({
      rewrittenText: "Analytical governed plan",
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
    const predicate = llmState.moderatorPredicate;
    const needsClarification =
      llmState.forceModeratorClarification ||
      (typeof predicate === "function" ? predicate(user) : false);
    // V1.2-PHASE5-FIX: extract the actual current draft so external data flows through both moderator passes
    let extractedDraft = null;
    const draftMatch = user.match(/Current draft:\s*([\s\S]*?)\n\s*Analytical summary/i);
    if (draftMatch) {
      extractedDraft = draftMatch[1].trim();
    }
    const defaultPrompt = llmState.creativeOutput || extractedDraft || (user && user.trim()) || "Moderator ok.";
    return stubResponse({
      moderatedPrompt: needsClarification ? "Clarify before continuing." : defaultPrompt,
      moderatorSummary: needsClarification ? "needs clarification" : "moderated",
      confidence: needsClarification ? 0.4 : 0.93,
      needsUserClarification: needsClarification,
      userQuestion: needsClarification ? "Provide clarification for governed workflow." : null,
    });
  }
  if (sys.includes("CREATIVE hemisphere")) {
    return stubResponse({ rewrittenText: llmState.creativeOutput, deltaSummary: "creative" });
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

let runCounter = 0;
const nextRunId = (prefix = "ds") => `${prefix}-${++runCounter}`;

function cloneRules(rules = []) {
  return JSON.parse(JSON.stringify(rules));
}

function getTelemetry(socket, subtype) {
  return socket.emitted.filter((e) => e.event === "telemetry" && e.payload?.subtype === subtype);
}

function telemetryData(entry) {
  return entry?.payload?.data || entry?.payload || {};
}

function tracePayload(entry) {
  if (!entry) return null;
  if (entry.trace) return entry.trace;
  if (entry.data?.trace) return entry.data.trace;
  return entry;
}

function collectCycleSnapshots(socket) {
  return getTelemetry(socket, "cycle-state").map((entry) => telemetryData(entry));
}

function getCanonicalTraces(socket, filterFn = () => true) {
  return getTelemetry(socket, "v1.1-canonical-trace")
    .map((entry) => telemetryData(entry))
    .filter(filterFn);
}

function getFinalOutputText(socket) {
  const event = socket.emitted.find((e) => e.event === "governed-output");
  return event?.payload?.payload?.text || "";
}

function getWorkflowFinishedTelemetry(socket) {
  return getTelemetry(socket, "workflow-finished").map((entry) => entry.payload?.data || entry.payload || {});
}

async function runScenario({
  input,
  mode = DATA_SCOPE_MODES.WORK,
  rules = [BASE_RULE],
  creativeOutput = "Creative governed draft",
  forceModeratorClarification = false,
  moderatorPredicate = null,
  sessionId = null,
  runId = null,
} = {}) {
  configureLLMState({ creativeOutput, forceModeratorClarification, moderatorPredicate });
  const socket = new FakeSocket(runId || nextRunId("sock"));
  runGovernedWorkflow._inFlight = false;
  const result = await runGovernedWorkflow(socket, {
    input,
    goal: "",
    maxCycles: null,
    governanceStrictness: 0.9,
    perfMode: "real",
    requiresGovernedOutput: true,
    rules: cloneRules(rules),
    sessionId: sessionId || socket.id,
    runId: runId || nextRunId("run"),
    dataScopeMode: mode,
  });
  return { socket, result };
}

function assertSnapshotsUseMode(snapshots, expectedMode, label) {
  snapshots.forEach((snap, idx) => {
    const mode = snap.snapshot?.dataScopeMode ?? snap.dataScopeMode;
    assert.strictEqual(mode, expectedMode, `${label} snapshot ${idx} lost mode`);
  });
}

function sanitizeTrace(trace) {
  if (!trace) return trace;
  const clone = JSON.parse(JSON.stringify(trace));
  delete clone.requestId;
  delete clone.resumeCount;
  delete clone.sessionId;
  return clone;
}

function ensureTelemetryOrder(order, required) {
  let cursor = -1;
  required.forEach((item) => {
    const idx = order.indexOf(item, cursor + 1);
    assert(idx !== -1, `Telemetry missing or out of order: ${item}`);
    cursor = idx;
  });
}

async function runAdversarialSequence(inputs, mode) {
  for (const prompt of inputs) {
    const { socket } = await runScenario({
      input: prompt,
      mode,
      rules: [BASE_RULE, CITATION_RULE],
      creativeOutput: `According to https://example.com data ${prompt}`,
    });
    const traces = getCanonicalTraces(
      socket,
      (entry) => entry.phase === "final" || entry.data?.phase === "final"
    );
    const finalEntry = traces.pop();
    assert(finalEntry, "No final canonical trace emitted");
    const tracePayload = finalEntry.trace || finalEntry.data?.trace || finalEntry;
    assert.strictEqual(tracePayload.dataScopeMode, mode, "Canonical trace mode mismatch");
    assert(Array.isArray(tracePayload.externalReferences), "Canonical trace missing external references array");
  }
}

(async () => {
  const failures = [];

  async function wrap(name, fn) {
    try {
      await fn();
      console.log(`[Phase5] ${name}: PASS`);
    } catch (err) {
      failures.push({ name, error: err });
      console.error(`[Phase5] ${name}: FAIL`, err.message);
    }
  }

  await wrap("Category1-ModePropagationAndResume", async () => {
    const runId = nextRunId("mode-prop");
    const { socket, result } = await runScenario({
      input: "draft an approval memo that references public data sources",
      mode: DATA_SCOPE_MODES.WEB,
      rules: [BASE_RULE, CITATION_RULE],
      creativeOutput: "According to https://example.com the figures shift",
      forceModeratorClarification: true, // V1.2-PHASE5-FIX: ensure moderator triggers the clarification checkpoint path
      runId,
    });
    assert(result?.paused, "Expected cycle to pause for clarification");
    assert.strictEqual(result.context?.dataScopeMode, DATA_SCOPE_MODES.WEB, "Checkpoint lost data scope mode");
    assert.strictEqual(result.context?.canonicalTrace?.modeAtEntry, DATA_SCOPE_MODES.WEB, "Trace missing mode at entry");
    const snapshots = collectCycleSnapshots(socket);
    assertSnapshotsUseMode(snapshots, DATA_SCOPE_MODES.WEB, "Initial cycle");
    const resume = await resumeFromClarification(socket, result.context, "citation: approval-source");
    assert(!resume?.paused, "Resume should complete after clarification");
    const resumedTraces = getCanonicalTraces(socket, (entry) => entry.resumed || entry.data?.resumed);
    const resumeTrace = tracePayload(resumedTraces.pop());
    assert.strictEqual(resumeTrace?.modeAtResume, DATA_SCOPE_MODES.WEB, "Resume trace lost scope mode");
  });

  await wrap("Category1-ModeChangeBlockedDuringClarification", async () => {
    const socket = new FakeSocket("mode-block");
    const state = { id: socket.id, dataScopeMode: DATA_SCOPE_MODES.WORK, pendingClarification: true };
    const result = handleDataScopeModeChange(state, socket, DATA_SCOPE_MODES.WEB);
    assert.strictEqual(result.updated, false, "Mode change should be blocked during clarification");
    const errorEvent = socket.emitted.find((e) => e.event === "governance-error");
    assert(errorEvent, "Expected governance-error event");
    assert.strictEqual(errorEvent.payload?.type, "mode-change-blocked", "Missing mode-change-blocked error");
  });

  await wrap("Category1-AlternatingSessionModes", async () => {
    const modes = [DATA_SCOPE_MODES.WORK, DATA_SCOPE_MODES.WEB, DATA_SCOPE_MODES.WORK, DATA_SCOPE_MODES.WEB];
    const traces = [];
    for (let i = 0; i < modes.length; i++) {
      const mode = modes[i];
      const { socket } = await runScenario({
        input: `draft governed memo ${i}`,
        mode,
        rules: [BASE_RULE, CITATION_RULE, PROVENANCE_RULE],
        creativeOutput: `According to https://example.com run ${i}`,
      });
      const finalEntry = getCanonicalTraces(
        socket,
        (entry) => entry.phase === "final" || entry.data?.phase === "final"
      ).pop();
      const finalTrace = tracePayload(finalEntry);
      traces.push(finalTrace);
      assert.strictEqual(finalTrace?.dataScopeMode, mode, `Trace ${i} retained wrong mode`);
    }
    traces.reduce((prev, curr, idx) => {
      if (!prev) return curr;
      if (idx % 2 === 1) {
        assert.notStrictEqual(curr.dataScopeMode, prev.dataScopeMode, "Modes leaked between cycles");
      }
      return curr;
    }, null);
  });

  await wrap("Category2-WorkModeMatrixBlock", async () => {
    const { socket, result } = await runScenario({
      input: "draft and search online for risk benchmarks",
      mode: DATA_SCOPE_MODES.WORK,
      rules: [BASE_RULE, NO_WEB_ACCESS_RULE],
    });
    assert.strictEqual(result, undefined, "Work mode web request should block before producing context");
    const finalOutput = getFinalOutputText(socket);
    assert(/cannot perform/i.test(finalOutput), "Expected block message in final output");
    const traceEntry = getCanonicalTraces(
      socket,
      (entry) => entry.phase === "final" || entry.data?.phase === "final"
    ).pop();
    const trace = tracePayload(traceEntry);
    assert.strictEqual(trace?.decision, "block", "Trace decision should be block");
  });

  await wrap("Category2-WorkModeValidatorBlock", async () => {
    const { socket } = await runScenario({
      input: "draft a compliance summary",
      mode: DATA_SCOPE_MODES.WORK,
      rules: [BASE_RULE],
      creativeOutput: "Internal memo referencing https://example.com for figures",
    });
    const finalOutput = getFinalOutputText(socket);
    assert(/external data content is forbidden/i.test(finalOutput), "Expected work-mode validator block");
    assert(finalOutput.includes("[Data Scope Mode: work]"), "Shaping missing work mode flag");
    assert(!finalOutput.includes("[External Data: USED]"), "Work mode output should not show external usage after block");
  });

  await wrap("Category3-WebCitationClarification", async () => {
    const { result } = await runScenario({
      input: "draft a plan and search for market data for supplier risk analysis",
      mode: DATA_SCOPE_MODES.WEB,
      rules: [BASE_RULE, CITATION_RULE],
      creativeOutput: "According to https://example.com the risk is high",
    });
    assert(result?.paused, "Citation gap should pause for clarification");
    assert.strictEqual(result.context?.pendingClarificationType, "citation", "Clarification type should be citation");
  });

  await wrap("Category3-WebProvenanceClarification", async () => {
    const { result } = await runScenario({
      input: "draft an analysis and search online for forecasts",
      mode: DATA_SCOPE_MODES.WEB,
      rules: [BASE_RULE, PROVENANCE_RULE],
      creativeOutput: "According to https://example.com the trend is up",
    });
    assert(result?.paused, "Provenance gap should pause for clarification");
    assert.strictEqual(result.context?.pendingClarificationType, "provenance", "Clarification type should be provenance");
  });

  await wrap("Category3-WebDualClarificationSequence", async () => {
    const first = await runScenario({
      input: "draft public filings summary and search public data for risk posture",
      mode: DATA_SCOPE_MODES.WEB,
      rules: [BASE_RULE, CITATION_RULE, PROVENANCE_RULE],
      creativeOutput: "According to https://example.com details pending",
    });
    assert(first.result?.paused, "First pass should pause");
    assert.strictEqual(first.result.context?.pendingClarificationType, "citation", "First clarification must request citation");
    const second = await resumeFromClarification(first.socket, first.result.context, "citation: market-risk-report");
    assert(second?.paused, "After providing citation, provenance should trigger second clarification");
    assert.strictEqual(second.context?.pendingClarificationType, "provenance", "Second clarification must be provenance");
    const final = await resumeFromClarification(first.socket, second.context, "[provenance: SEC public filing]");
    assert(!final?.paused, "Workflow should complete after both clarifications");
    const output = getFinalOutputText(first.socket);
    assert(output.includes("[Citation: citation: market-risk-report]"), "Final output should include provided citation");
    assert(output.includes("[Provenance: [provenance: SEC public filing]]"), "Final output should include provided provenance");
  });

  await wrap("Category4-MixedSourceConstraintBlock", async () => {
    const { socket } = await runScenario({
      input: "draft a report that combines internal report with this public article https://example.com",
      mode: DATA_SCOPE_MODES.WEB,
      rules: [BASE_RULE, NO_PUBLIC_MIX_RULE, CITATION_RULE],
      creativeOutput: "[internal] Internal observation [external] https://example.com insight",
    });
    const text = getFinalOutputText(socket);
    assert(/public data violates/i.test(text) || /violates governance constraints/i.test(text), "Expected block for mixed sources");
    assert(text.includes("[Warning: Mixed Internal + External Sources Detected]"), "Shaping should warn about mixed sources");
    assert(text.includes("[Citation Required: MISSING]"), "Shaping should note missing citation when blocked");
  });

  await wrap("Category4-MixedSourceAllowedWithoutConstraint", async () => {
    const { socket } = await runScenario({
      input: "draft a summary that combines references quickly",
      mode: DATA_SCOPE_MODES.WEB,
      rules: [BASE_RULE],
      creativeOutput: "[internal] Summary [external] https://example.com data",
    });
    const text = getFinalOutputText(socket);
    assert(text.includes("[Data Scope Mode: web]"), "Web shaping missing mode flag");
    assert(text.includes("[Warning: Mixed Internal + External Sources Detected]"), "Warning should appear even without constraint");
  });

  await wrap("Category5-TelemetryModeSignals", async () => {
    const socket = new FakeSocket("mode-telemetry");
    const state = { id: socket.id, dataScopeMode: DATA_SCOPE_MODES.WORK, pendingClarification: false };
    handleDataScopeModeChange(state, socket, DATA_SCOPE_MODES.WEB);
    const modeEvent = socket.emitted.find((e) => e.event === "telemetry" && e.payload?.subtype === "v1.2-mode-change");
    assert(modeEvent, "Mode change telemetry missing");
    assert.strictEqual(modeEvent.payload?.data?.mode, DATA_SCOPE_MODES.WEB, "Telemetry payload missing mode");

    const { socket: runSocket } = await runScenario({
      input: "draft a memo",
      mode: DATA_SCOPE_MODES.WEB,
      rules: [BASE_RULE, CITATION_RULE],
      creativeOutput: "According to https://example.com data",
    });
    const order = runSocket.emitted
      .filter((e) => e.event === "telemetry")
      .map((e) => e.payload?.subtype)
      .filter(Boolean);
    ensureTelemetryOrder(order, ["v1.2-mcp-entry-mode", "v1.1-grammar", "v1.1-constraint-normalization"]);
    const validatorScopes = getTelemetry(runSocket, "v1.2-validator-scope");
    assert(validatorScopes.length > 0, "Validator scope telemetry missing");
    validatorScopes.forEach((entry) => {
      assert.strictEqual(entry.payload?.data?.mode, DATA_SCOPE_MODES.WEB, "Validator telemetry missing mode");
    });
  });

  await wrap("Category6-ShapingWorkMode", async () => {
    const { socket } = await runScenario({
      input: "draft governance memo (internal only)",
      mode: DATA_SCOPE_MODES.WORK,
      rules: [BASE_RULE],
      creativeOutput: "Internal memo body",
    });
    const text = getFinalOutputText(socket);
    assert(text.includes("[Data Scope Mode: work]"), "Work shaping missing mode block");
    assert(!text.includes("[External Data: USED]"), "Work shaping should not flag external data");
    assert(!text.includes("[Provenance:"), "Work shaping should not add provenance markers");
  });

  await wrap("Category6-ShapingWebModeFlags", async () => {
    const { socket } = await runScenario({
      input: "draft and compile public summary",
      mode: DATA_SCOPE_MODES.WEB,
      rules: [BASE_RULE, NO_PUBLIC_MIX_RULE, CITATION_RULE],
      creativeOutput: "[internal] Insight [external] https://example.com",
    });
    const text = getFinalOutputText(socket);
    assert(text.includes("[Data Scope Mode: web]"), "Web shaping missing mode");
    assert(text.includes("[External Data: USED]"), "Web shaping missing external data marker");
    assert(text.includes("[Provenance: MISSING]"), "Web shaping should mark missing provenance");
    assert(text.includes("[Citation Required: MISSING]"), "Web shaping should mark missing citation when required");
  });

  await wrap("Category7-AdversarialInputs", async () => {
    const adversarialInputs = [
      "draft and execute external workflow draft finalize find",
      "draft a memo and lol search this? haha probably",
      "draft external? maybe not? idk just run the analysis",
      "draft a link: http://abc.com mixed with internal content",
      "draft report according to example.com/info internal doc says...",
    ];
    await runAdversarialSequence(adversarialInputs, DATA_SCOPE_MODES.WEB);
    await runAdversarialSequence(adversarialInputs, DATA_SCOPE_MODES.WORK);
  });

  await wrap("Category8-Nondeterminism", async () => {
    const prompt = "execute the workflow carefully with web data";
    const baseline = { work: null, web: null };
    for (const mode of [DATA_SCOPE_MODES.WORK, DATA_SCOPE_MODES.WEB]) {
      for (let i = 0; i < 5; i++) {
        const { socket } = await runScenario({
          input: prompt,
          mode,
          rules: [BASE_RULE, CITATION_RULE, PROVENANCE_RULE],
          creativeOutput: "According to https://example.com deterministic output",
        });
        const finalEntry = getCanonicalTraces(
          socket,
          (entry) => entry.phase === "final" || entry.data?.phase === "final"
        ).pop();
        const trace = sanitizeTrace(tracePayload(finalEntry));
        const text = getFinalOutputText(socket);
        if (!baseline[mode]) {
          baseline[mode] = { trace, text };
        } else {
          assert.deepStrictEqual(trace, baseline[mode].trace, `Trace mismatch on rerun (${mode})`);
          assert.strictEqual(text, baseline[mode].text, `Output mismatch on rerun (${mode})`);
        }
      }
    }
  });

  await wrap("Category9-StateLeakPrevention", async () => {
    const first = await runScenario({
      input: "draft a plan and search online for supplier signals",
      mode: DATA_SCOPE_MODES.WEB,
      rules: [BASE_RULE, CITATION_RULE, PROVENANCE_RULE],
      creativeOutput: "According to https://example.com state leak test",
    });
    assert(first.result?.paused, "First scenario should pause");
    const resumeCitation = await resumeFromClarification(first.socket, first.result.context, "citation: vendor-source");
    const resumeProvenance = await resumeFromClarification(first.socket, resumeCitation.context, "[provenance: vendor-site]");
    assert(!resumeProvenance?.paused, "Should finish after clarifications");
    const firstOutput = getFinalOutputText(first.socket);
    assert(firstOutput.includes("[Citation: citation: vendor-source]"), "First run missing provided citation");
    const secondRun = await runScenario({
      input: "draft internal memo post-clarification",
      mode: DATA_SCOPE_MODES.WORK,
      rules: [BASE_RULE],
      creativeOutput: "Internal memo only",
    });
    const secondOutput = getFinalOutputText(secondRun.socket);
    assert(!secondOutput.includes("vendor-source"), "Citation leaked to next cycle");
    assert(!secondOutput.includes("vendor-site"), "Provenance leaked to next cycle");
  });

  if (failures.length) {
    console.error(`DataScopeMode Suite encountered ${failures.length} failure(s).`);
    failures.forEach((failure) => console.error(failure.name, failure.error?.stack || failure.error));
    process.exit(1);
  } else {
    console.log("DataScopeMode Suite passed.");
  }
})();
