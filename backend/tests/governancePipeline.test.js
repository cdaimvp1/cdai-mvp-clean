// Governance pipeline static-behavior checks (no production code changes).
// These tests use the same lightweight harness style as the existing *.test.js files.

// TEST-D-FIX: force stubbed OpenAI path for deterministic harness
process.env.ALLOW_OPENAI_STUB = "1";
process.env.NODE_ENV = process.env.NODE_ENV || "test";

const assert = require("assert");
const {
  runGovernedWorkflow,
  parseGovernanceEnvelope,
} = require("../workflow/runGovernedWorkflow");
const { classifyGovernanceIntent } = require("../workflow/openaiClient");

// -----------------------------------------------------------------------------=
// Fake socket (captures telemetry)
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

// -----------------------------------------------------------------------------=
// OpenAI stub (single-process; avoids network)
// -----------------------------------------------------------------------------=
let fetchCounts = {
  explicit: 0,
  inference: 0,
};

function resetFetchCounts() {
  fetchCounts = { explicit: 0, inference: 0 };
}

global.fetch = async (_url, options = {}) => {
  const body = JSON.parse(options.body || "{}");
  const sys = body.messages?.[0]?.content || "";
  const user = body.messages?.find((m) => m.role === "user")?.content || "";
  const needsJson = body.response_format?.type === "json_object" || body.response_format === "json";

  // Task extraction
  if (sys.includes("Extract TASKS ONLY")) {
    const tasks = user ? [user.trim()] : [];
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ tasks }) } }],
      }),
    };
  }

  // Rule extraction
  if (sys.includes("Extract RULES ONLY")) {
    const rules = user && /rule/i.test(user)
      ? {
          explicit: ["Never use jargon.", "Speak politely.", "Include a one-sentence summary."].filter(
            (r) => user.includes(r.split(" ")[0].toLowerCase()) || user.toLowerCase().includes("rule")
          ),
          general: [],
          candidateInferred: [],
        }
      : { explicit: [], general: [], candidateInferred: [] };

    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({ rules }),
            },
          },
        ],
      }),
    };
  }

  // User intent classifier (chat vs task vs rules vs mixed)
  if (sys.includes("You classify user messages for a governed AI system")) {
    let intent = "task";
    if (/add rule/i.test(user)) intent = "rules";
    else if (/rules for task/i.test(user)) intent = "task";
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                intent,
                confidence: 0.9,
                reason: "stubbed",
              }),
            },
          },
        ],
      }),
    };
  }

  // PCGP explicit extraction
  if (sys.includes("You are a rule-extraction engine")) {
    fetchCounts.explicit += 1;
    const explicit_rules =
      user && /rule/i.test(user)
        ? [{ rule: "All output must be formal.", type: "requirement" }]
        : [];
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({ explicit_rules }),
            },
          },
        ],
      }),
    };
  }

  // PCGP inference
  if (sys.includes("You are a rule inference engine")) {
    fetchCounts.inference += 1;
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                inferred_rules: [{ rule: "Inferred: keep tone neutral", confidence: 0.6 }],
              }),
            },
          },
        ],
      }),
    };
  }

  // Task Agent / Analytical / Moderator / Creative / Validator paths
  const jsonContent = (payload) => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(payload) } }],
    }),
  });

  if (sys.includes("Task Agent in a governed")) return jsonContent("task draft");
  if (sys.includes("ANALYTICAL hemisphere")) {
    return jsonContent({
      rewrittenText: "analytical draft",
      directives: [],
      validation: {
        forbiddenHits: [],
        wordCountOk: true,
        artifactsOk: true,
        impliedReliabilityOk: true,
      },
      inferredConstraints: [],
      deltaSummary: "analytical pass",
    });
  }
  if (sys.includes("MODERATOR between the Analytical and Creative hemispheres")) {
    return jsonContent({
      moderatedPrompt: "keep steady",
      moderatorSummary: "moderated",
      confidence: 0.9,
      needsUserClarification: false,
      userQuestion: null,
    });
  }
  if (sys.includes("CREATIVE hemisphere")) {
    return jsonContent({
      rewrittenText: "creative draft",
      deltaSummary: "creative pass",
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

  // Default stub
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: needsJson ? "{}" : "stubbed" } }],
    }),
  };
};

// -----------------------------------------------------------------------------=
// Minimal workflow runner (mirrors server.js run-workflow path for tests)
// -----------------------------------------------------------------------------=
async function processMessageThroughWorkflow(text, socketState) {
  const socket = new FakeSocket();
  const ledger = [];
  const goal = "";

  const envelope = parseGovernanceEnvelope(text);
  const intent = await classifyGovernanceIntent(text);

  // Governance command path (rule_addition only for this harness)
  if (intent.label === "rule_addition") {
    const ruleText =
      (intent.ruleCandidates && intent.ruleCandidates[0]) ||
      text.replace(/add rule:?/i, "").trim();
    if (ruleText) {
      socketState.governanceRules.push({
        text: ruleText,
        origin: "user",
        status: "pending",
      });
    }
    return { socket, socketState, ledger, intent, envelope, handled: true };
  }

  runGovernedWorkflow._inFlight = false;

  await runGovernedWorkflow(socket, {
    input: text,
    goal,
    maxCycles: null,
    governanceStrictness: 0.85,
    perfMode: "real",
    rules: socketState.governanceRules,
    baseLedger: ledger,
    governanceEnvelope: envelope,
  });

  return { socket, socketState, ledger, intent, envelope, handled: false };
}

// -----------------------------------------------------------------------------=
// Tests
// -----------------------------------------------------------------------------=
async function testTaskRulesDoNotMutateGovernanceStore() {
  const socketState = { governanceRules: [] };
  const input = `RULES FOR TASK ONLY:
1. Never use jargon.
2. Speak politely.
3. Include a one-sentence summary.

TASK:
Explain the new AI review process.`;

  const { ledger, socket } = await processMessageThroughWorkflow(input, socketState);

  const tasksExtracted = ledger.some((e) => e.stage === "TaskExtraction");
  const ruleExtraction = ledger.filter((e) => e.stage === "RuleExtraction");
  const governanceMutated = socketState.governanceRules.length > 0;
  const governanceCommandLogged = ledger.some((e) =>
    (e.summary || "").toLowerCase().includes("rule_addition")
  );

  console.log("TEST 1 diagnostics:", {
    tasksExtracted,
    ruleExtractionSummaries: ruleExtraction.map((e) => e.summary),
    governanceMutated,
    governanceCommandLogged,
  });

  assert.ok(tasksExtracted, "Expected a task to be extracted.");
  assert.ok(ruleExtraction.length > 0, "Expected rules to be extracted.");
  assert.strictEqual(
    governanceMutated,
    false,
    "Task-level rules should not mutate persistent governanceRules."
  );
  assert.strictEqual(
    governanceCommandLogged,
    false,
    "No governance command logging should occur for task-only rules."
  );
}

async function testExplicitGovernanceCommandMutatesRules() {
  const socketState = { governanceRules: [] };
  const input = "add rule: All output must be formal.";

  const { intent } = await processMessageThroughWorkflow(input, socketState);

  console.log("TEST 2 diagnostics:", {
    intent,
    governanceRules: socketState.governanceRules,
  });

  assert.strictEqual(intent.label, "rule_addition", "Expected governance command intent.");
  assert.ok(socketState.governanceRules.length === 1, "Expected governanceRules to update.");
  assert.ok(
    socketState.governanceRules[0].text.toLowerCase().includes("formal"),
    "Expected the added rule to be persisted."
  );
}

async function testPlainTaskRunsAndReportsPCGP() {
  const socketState = { governanceRules: [] };
  const input = "Draft an email to my team explaining our new AI review process.";

  const { ledger, socket } = await processMessageThroughWorkflow(input, socketState);

  const tasksExtracted = ledger.some((e) => e.stage === "TaskExtraction");
  const pcgpAttempts = ledger.filter((e) =>
    (e.summary || "").toLowerCase().includes("explicit rules extracted via api")
  );
  const governanceMutated = socketState.governanceRules.length > 0;

  console.log("TEST 3 diagnostics:", {
    tasksExtracted,
    pcgpCalled: pcgpAttempts.length > 0,
    governanceMutated,
    ledgerSummaries: ledger.map((e) => e.summary).slice(0, 8),
      finalOutputs: socket.emitted
        .filter((e) => e.event === "telemetry" && e.payload?.subtype === "final-output")
      .map((e) => e.payload.text),
  });

  assert.ok(tasksExtracted, "Expected task extraction to run.");
  assert.strictEqual(governanceMutated, false, "Persistent rules should remain untouched.");
}

// -----------------------------------------------------------------------------=
// Strictness-focused tests
// -----------------------------------------------------------------------------=
async function runAndSummarize(text) {
  resetFetchCounts();
  const socketState = { governanceRules: [] };
  const result = await processMessageThroughWorkflow(text, socketState);
  const cycles = result.socket.emitted.filter(
    (e) => e.event === "telemetry" && e.payload?.subtype === "cycle-update"
  );
  const plan = result.socket.emitted.find(
    (e) => e.event === "telemetry" && e.payload?.subtype === "cycle-plan"
  );
  const driftLogs = result.ledger.filter((e) => e.stage === "ContextDrift");
  const ruleExtractions = result.ledger.filter((e) => e.stage === "RuleExtraction");
  const ruleInferenceLogs = result.ledger.filter((e) => e.stage === "RuleInference");
  return {
    ...result,
    plannedCycles: plan?.payload?.plannedCycles || cycles.length,
    cyclesRan: cycles.length,
    driftLogs,
    ruleExtractions,
    ruleInferenceLogs,
    fetchCounts: { ...fetchCounts },
  };
}

async function testStrictness0() {
  const input = "Draft a thank you note to my team.";
  const summary = await runAndSummarize(input);
  console.log("S0 diagnostics:", {
    plannedCycles: summary.plannedCycles,
    cyclesRan: summary.cyclesRan,
    fetchCounts: summary.fetchCounts,
    governanceRules: summary.socketState.governanceRules,
  });
  assert.ok(summary.cyclesRan <= 1, "Strictness 0/1 should run at most one cycle.");
  assert.strictEqual(summary.socketState.governanceRules.length, 0, "No governance mutation expected.");
}

async function testStrictness1() {
  const input = `Draft an email and follow these rules:
1. Be polite.
2. Keep it short.`;
  const summary = await runAndSummarize(input);
  console.log("S1 diagnostics:", {
    plannedCycles: summary.plannedCycles,
    cyclesRan: summary.cyclesRan,
    fetchCounts: summary.fetchCounts,
  });
  assert.ok(summary.cyclesRan >= 1, "Strictness 1 should execute at least one cycle.");
  assert.strictEqual(summary.socketState.governanceRules.length, 0, "No governance mutation expected.");
}

async function testStrictness2() {
  const input = `Please write a project update and follow these rules:
1. Keep it clear.
2. Maintain professionalism.`;
  const summary = await runAndSummarize(input);
  console.log("S2 diagnostics:", {
    plannedCycles: summary.plannedCycles,
    cyclesRan: summary.cyclesRan,
    fetchCounts: summary.fetchCounts,
  });
  assert.ok(summary.cyclesRan >= 1, "Strictness 2 should execute cycles.");
  assert.strictEqual(summary.socketState.governanceRules.length, 0, "No governance mutation expected.");
}

async function testStrictness3() {
  const input = `Provide a compliance-aligned explanation of a policy change and follow these rules:
1. No legal commitments.
2. Maintain alignment with internal policies.`;
  const summary = await runAndSummarize(input);
  console.log("S3 diagnostics:", {
    plannedCycles: summary.plannedCycles,
    cyclesRan: summary.cyclesRan,
    fetchCounts: summary.fetchCounts,
    driftLogs: summary.driftLogs.length,
  });
  assert.ok(summary.plannedCycles >= 1, "Strictness 3 should plan cycles.");
  assert.ok(summary.cyclesRan >= 1, "Strictness 3 should run cycles.");
  assert.ok(summary.socketState.governanceRules.length === 0, "No persistent mutation expected.");
}

async function testStrictness4() {
  const socketState = { governanceRules: [] };
  const input = "add rule: All contractual language must be validated.";
  const { intent, handled } = await processMessageThroughWorkflow(input, socketState);
  console.log("S4 diagnostics:", {
    intent,
    governanceRules: socketState.governanceRules,
  });
  assert.ok(handled, "Governance command should be handled outside MCP.");
  assert.ok(intent.label === "rule_addition", "Expected governance command intent.");
  assert.ok(socketState.governanceRules.length === 1, "Governance rules must be updated.");
}

async function testGovernanceCommandStrictness() {
  const socketState = { governanceRules: [] };
  const input = "add rule: Never disclose internal benchmarks.";
  const { intent, handled } = await processMessageThroughWorkflow(input, socketState);
  console.log("G1 diagnostics:", { intent, handled, rules: socketState.governanceRules });
  assert.ok(handled, "Governance command should be handled.");
  assert.ok(intent.label === "rule_addition", "Expected rule_addition intent.");
  assert.ok(socketState.governanceRules.length === 1, "Persistent mutation expected.");
}

async function testRuleLikeButNotGovernanceCommand() {
  const input = `RULES FOR TASK ONLY:
1. Keep it polite.
TASK: Write an email.`;
  const summary = await runAndSummarize(input);
  console.log("G2 diagnostics:", {
    plannedCycles: summary.plannedCycles,
    fetchCounts: summary.fetchCounts,
    governanceRules: summary.socketState.governanceRules,
  });
  assert.ok(summary.fetchCounts.inference <= 1, "Inference bounded for task-level rules.");
  assert.strictEqual(summary.socketState.governanceRules.length, 0, "No governance mutation expected.");
}

async function testValidatorCycleCounts() {
  const low = await runAndSummarize("Draft a thank you note to my team.");
  const mid = await runAndSummarize("Please write a project update and follow these rules:\n1. Keep it clear.\n2. Maintain professionalism.");
  const high = await runAndSummarize("Provide a compliance-aligned explanation of a policy change and follow these rules:\n1. No legal commitments.\n2. Maintain alignment with internal policies.");

  console.log("Validator diagnostics:", {
    lowCycles: low.plannedCycles,
    midCycles: mid.plannedCycles,
    highCycles: high.plannedCycles,
  });

  assert.ok(low.plannedCycles <= mid.plannedCycles, "Low strictness should not exceed mid strictness cycles.");
  assert.ok(high.plannedCycles >= mid.plannedCycles, "High strictness should be at least as many cycles as mid.");
}

(async () => {
  try {
    await testTaskRulesDoNotMutateGovernanceStore();
    await testExplicitGovernanceCommandMutatesRules();
    await testPlainTaskRunsAndReportsPCGP();
    await testStrictness0();
    await testStrictness1();
    await testStrictness2();
    await testStrictness3();
    await testStrictness4();
    await testGovernanceCommandStrictness();
    await testRuleLikeButNotGovernanceCommand();
    await testValidatorCycleCounts();
    console.log("Governance pipeline tests passed.");
  } catch (err) {
    console.error("Governance pipeline tests failed:", err.stack || err.message || err);
    process.exit(1);
  }
})();
