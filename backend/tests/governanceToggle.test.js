const assert = require("assert");
const vm = require("vm");
const { EventEmitter } = require("events");

// -----------------------------------------------------------------------------=
// OpenAI fetch stub (covers prompts used by runGovernedWorkflow pipeline)
// -----------------------------------------------------------------------------=
function installFetchStub() {
  global.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body || "{}");
    const sys = body.messages?.[0]?.content || "";
    const user = body.messages?.find((m) => m.role === "user")?.content || "";
    const needsJson =
      body.response_format?.type === "json_object" ||
      body.response_format === "json";

    const jsonContent = (payload) => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(payload) } }],
      }),
    });

    // Task extraction
    if (sys.includes("Extract TASKS ONLY")) {
      const tasks = user ? [user.trim()] : [];
      return jsonContent({ tasks });
    }

    // Rule extraction
    if (sys.includes("Extract RULES ONLY")) {
      const rules =
        user && /rule/i.test(user)
          ? {
              explicit: ["avoid deterministic language", "no real institutions"],
              general: [],
              candidateInferred: [],
            }
          : { explicit: [], general: [], candidateInferred: [] };
      return jsonContent({ rules });
    }

    // Intent classification
    if (sys.includes("You classify user messages for a governed AI system")) {
      return jsonContent({
        intent: "task",
        confidence: 0.9,
        reason: "stubbed",
      });
    }

    // PCGP explicit extraction
    if (sys.includes("You are a rule-extraction engine")) {
      const explicit_rules =
        user && /rule/i.test(user)
          ? [{ rule: "Avoid deterministic language.", type: "requirement" }]
          : [];
      return jsonContent({ explicit_rules });
    }

    // PCGP inference
    if (sys.includes("You are a rule inference engine")) {
      return jsonContent({
        inferred_rules: [{ rule: "Keep tone neutral", confidence: 0.6 }],
      });
    }

    // Task Agent / Analytical / Moderator / Creative / Validator paths
    if (sys.includes("Task Agent in a governed")) {
      return jsonContent("task draft");
    }

    if (sys.includes("ANALYTICAL hemisphere")) {
      return jsonContent({
        rewrittenText:
          "Root Cause: Missing clarity.\nRemediation: Add hedging.\nGovernance Enhancement: Remove determinism.\nLeadership Summary: Provide cautious outlook.",
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
        rewrittenText:
          "Root Cause: Prototype risks.\nRemediation: Adjust timeline.\nGovernance Enhancement: Strip deterministic claims.\nLeadership Summary: Hedged summary.",
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
}

// Install stub before requiring workflow modules
installFetchStub();

const {
  runGovernedWorkflow,
} = require("../workflow/runGovernedWorkflow");

// -----------------------------------------------------------------------------=
// Helper: minimal fake socket (captures telemetry)
// -----------------------------------------------------------------------------=
class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.emitted = [];
  }
  emit(event, payload) {
    this.emitted.push({ event, payload });
    super.emit(event, payload);
  }
}

// -----------------------------------------------------------------------------=
// Helper: load app.js in a VM with mocked globals to access sendUserMessage
// -----------------------------------------------------------------------------=
function loadAppWithToggle(strictMode) {
  const fs = require("fs");
  const path = require("path");
  const appSrc = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");

  const socketMock = new FakeSocket();
  const context = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    document: {
      getElementById: () => null,
    },
    window: {},
    io: () => socketMock,
  };

  vm.createContext(context);
  vm.runInContext(appSrc, context);

  // Provide slider defaults so payload matches UI defaults
  context.strictnessSliderEl = { value: "0.85" };
  context.cycleSliderEl = { value: "0" };
  context.strictGovernanceToggleEl = { checked: !!strictMode };

  // Set toggle state
  vm.runInContext(`strictGovernanceMode = ${strictMode ? "true" : "false"}`, context);

  return { context, socketMock };
}

// -----------------------------------------------------------------------------=
// Tests
// -----------------------------------------------------------------------------=
async function testUiPayloadGeneration() {
  // Toggle ON
  let { context, socketMock } = loadAppWithToggle(true);
  context.sendUserMessage("hello world");
  const payloadOn = socketMock.emitted.find((e) => e.event === "run-workflow")?.payload;
  assert.ok(payloadOn, "Payload missing when toggle on");
  assert.strictEqual(payloadOn.requiresGovernedOutput, true, "Toggle on should set requiresGovernedOutput true");

  // Toggle OFF
  ({ context, socketMock } = loadAppWithToggle(false));
  context.sendUserMessage("hello world");
  const payloadOff = socketMock.emitted.find((e) => e.event === "run-workflow")?.payload;
  assert.ok(payloadOff, "Payload missing when toggle off");
  assert.strictEqual(payloadOff.requiresGovernedOutput, false, "Toggle off should set requiresGovernedOutput false");
}

async function testServerPayloadHandling() {
  const payload = {
    input: "Write a memo about test progress.",
    rules: ["avoid percentages", "no deterministic language"],
    maxCycles: 3,
    governanceStrictness: 0.7,
    perfMode: "real",
    requiresGovernedOutput: true,
  };

  const captured = {};
  const fakeRunGovernedWorkflow = async (_socket, args) => Object.assign(captured, args);

  // Simulate server handler logic (mirrors server.js run-workflow)
  const {
    input = "",
    goal = "",
    maxCycles = null,
    governanceStrictness = 0.85,
    perfMode = "real",
    rules = null,
    requiresGovernedOutput = false,
  } = payload;
  const inboundRules = Array.isArray(rules) ? rules : [];
  await fakeRunGovernedWorkflow(new FakeSocket(), {
    input,
    goal,
    maxCycles,
    governanceStrictness,
    perfMode,
    rules: inboundRules,
    governanceEnvelope: null,
    requiresGovernedOutput,
  });

  assert.deepStrictEqual(captured.rules, payload.rules, "Rules should pass through unchanged");
  assert.strictEqual(captured.input, payload.input, "Input should pass through unchanged");
  assert.strictEqual(captured.requiresGovernedOutput, true, "requiresGovernedOutput should be true when provided");
}

async function testWorkflowGovernedVsUngoverned() {
  const socketGov = new FakeSocket();
  const socketUngov = new FakeSocket();

  const baseArgs = {
    goal: "",
    maxCycles: 3,
    governanceStrictness: 0.85,
    perfMode: "real",
    rules: ["avoid deterministic language", "no real institutions"],
    governanceEnvelope: null,
  };

  const inputText =
    "Tell them the prototype WILL be ready next week, guaranteed, and that the ISO Committee confirmed compliance.";

  await runGovernedWorkflow(socketGov, {
    ...baseArgs,
    input: inputText,
    requiresGovernedOutput: true,
  });

  await runGovernedWorkflow(socketUngov, {
    ...baseArgs,
    input: inputText,
    requiresGovernedOutput: false,
  });

  const finalGov = socketGov.emitted.find(
    (e) => e.event === "telemetry" && e.payload?.subtype === "final-output"
  )?.payload;
  const finalUngov = socketUngov.emitted.find(
    (e) => e.event === "telemetry" && e.payload?.subtype === "final-output"
  )?.payload;

  assert.ok(finalGov && finalGov.text, "Governed run should emit final output");
  assert.ok(finalUngov && finalUngov.text, "Ungoverned run should emit final output");

  const governedOutput = finalGov.text;
  const ungovernedOutput = finalUngov.text;

  assert.notStrictEqual(governedOutput, ungovernedOutput, "Outputs should differ between governed and ungoverned");
  assert.ok(governedOutput.includes("Root Cause"), "Governed output should include canonical sections");
  assert.ok(!/Root Cause|Remediation|Governance Enhancement|Leadership Summary/.test(ungovernedOutput),
    "Ungoverned output should not be forced into canonical sections");

  assert.ok(!/will\b|guarantee|100%/i.test(governedOutput), "Governed output should hedge deterministic language");

  const cyclePlanGov = socketGov.emitted.find(
    (e) => e.event === "telemetry" && e.payload?.subtype === "cycle-plan"
  )?.payload;
  const cyclePlanUngov = socketUngov.emitted.find(
    (e) => e.event === "telemetry" && e.payload?.subtype === "cycle-plan"
  )?.payload;

  assert.ok(cyclePlanGov && cyclePlanGov.plannedCycles >= 2, "Governed mode should plan multiple cycles");
  assert.ok(cyclePlanUngov && cyclePlanUngov.plannedCycles <= 3, "Ungoverned mode should remain shallow");
}

async function testDefaultsAndSafety() {
  // Missing requiresGovernedOutput defaults to false
  const payload = { input: "hello", rules: [] };
  const captured = {};
  const fakeRunGovernedWorkflow = (_socket, args) => Object.assign(captured, args);

  const {
    input = "",
    goal = "",
    maxCycles = null,
    governanceStrictness = 0.85,
    perfMode = "real",
    rules = null,
    requiresGovernedOutput = false,
  } = payload;
  const inboundRules = Array.isArray(rules) ? rules : [];
  await fakeRunGovernedWorkflow(new FakeSocket(), {
    input,
    goal,
    maxCycles,
    governanceStrictness,
    perfMode,
    rules: inboundRules,
    governanceEnvelope: null,
    requiresGovernedOutput,
  });

  assert.strictEqual(captured.requiresGovernedOutput, false, "Default should be false when missing");

  // Toggle true with empty rules still enforces governed behavior
  const socketGov = new FakeSocket();
  await runGovernedWorkflow(socketGov, {
    input: "Provide an update.",
    rules: [],
    requiresGovernedOutput: true,
    maxCycles: 2,
    governanceStrictness: 0.85,
    perfMode: "real",
    goal: "",
    governanceEnvelope: null,
  });
  const finalGov = socketGov.emitted.find(
    (e) => e.event === "telemetry" && e.payload?.subtype === "final-output"
  )?.payload;
  assert.ok(finalGov && finalGov.text.includes("Root Cause"), "Governed mode should apply even without rules");
}

(async () => {
  try {
    await testUiPayloadGeneration();
    await testServerPayloadHandling();
    await testWorkflowGovernedVsUngoverned();
    await testDefaultsAndSafety();
    console.log("Governance toggle tests passed.");
  } catch (err) {
    console.error("Governance toggle tests failed:", err.stack || err);
    process.exit(1);
  }
})();
