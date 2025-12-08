/**
 * @fileoverview Jest harness that drives the governed workflow end-to-end with
 * deterministic stubs.
 */

process.env.ALLOW_OPENAI_STUB = "1";
process.env.NODE_ENV = process.env.NODE_ENV || "test";

const path = require("path");
const { runGovernedWorkflow } = require("../workflow/runGovernedWorkflow");
const { DATA_SCOPE_MODES } = require("../workflow/governanceConstants");
const { createMockSocket } = require("./harness/mockSocket");
const { installMockOpenAIStub } = require("./harness/mockOpenAI");
const rules = require("./fixtures/rules.json");

const PASS_MAP = {
  Analytical: "A",
  Moderator: "M1",
  "Moderator-2": "M2",
  Creative: "C",
  Validator: "V",
};

const GOVERNED_PROMPT = "Draft me a 3-step project plan for migrating a database.";

async function runHarnessCycle() {
  const socket = createMockSocket();
  const ledger = [];

  runGovernedWorkflow._inFlight = false;
  await runGovernedWorkflow(socket, {
    input: GOVERNED_PROMPT,
    goal: "Harness verification cycle",
    maxCycles: null,
    governanceStrictness: 0.95,
    dataScopeMode: DATA_SCOPE_MODES.WORK,
    governanceEnvelope: {
      requiresGovernedOutput: true,
      constraints: [{ type: "hard_block", sourceRuleId: "HARNESS-RULE" }],
    },
    sessionId: "harness-session",
    runId: "harness-run",
    baseLedger: ledger,
    rules,
  });

  return { socket, ledger };
}

describe("Governance workflow harness", () => {
  let restoreFetch;

  beforeEach(() => {
    restoreFetch = installMockOpenAIStub();
  });

  afterEach(() => {
    if (restoreFetch) restoreFetch();
    jest.restoreAllMocks();
  });

  test("emits deterministic pass ordering and payload metadata", async () => {
    const { socket, ledger } = await runHarnessCycle();

    // Step C: Verify pass ordering
    const exitStages = socket.emitted
      .filter(
        (evt) =>
          evt.event === "telemetry" &&
          evt.payload?.subtype === "cycle-state" &&
          evt.payload?.data?.phase === "exit"
      )
      .map((evt) => {
        const stage = evt.payload?.data?.stage;
        return PASS_MAP[stage] || stage;
      })
      .filter(Boolean);

    const expectedSequence = ["A", "M1", "C", "M2", "V"];
    let cursor = -1;
    expectedSequence.forEach((stage) => {
      const nextIndex = exitStages.indexOf(stage, cursor + 1);
      expect(nextIndex).toBeGreaterThan(cursor);
      cursor = nextIndex;
    });

    const cycleStartIndex = socket.emitted.findIndex((evt) => evt.event === "mcp:cycle_start");
    const cycleCompleteIndex = socket.emitted.findIndex((evt) => evt.event === "mcp:cycle_complete");
    expect(cycleStartIndex).toBeGreaterThan(-1);
    expect(cycleCompleteIndex).toBeGreaterThan(cycleStartIndex);

    // Step D: Verify payload correctness for each pass
    expect(ledger.length).toBeGreaterThanOrEqual(5);
    ledger.forEach((entry) => {
      expect(entry.timestamp).toBeTruthy();
      expect(entry.stage).toBeTruthy();
      expect(entry.summary || entry.text).toBeTruthy();
    });

    const governedOutput = socket.emitted
      .filter((evt) => evt.event === "governed-output")
      .pop();
    expect(governedOutput).toBeTruthy();
    const finalText = governedOutput.payload?.payload?.text || "";
    expect(finalText).toMatch(/\[Data Scope Mode:/);

    // Rule evaluation markers come through telemetry snapshots.
    const telemetryEvents = socket.emitted.filter((evt) => evt.event === "telemetry");
    const constraintEval = telemetryEvents.find(
      (evt) => evt.payload?.subtype === "v1.1-constraint-algebra"
    );
    const matrixEval =
      telemetryEvents.find((evt) => evt.payload?.subtype === "v1.2-matrix-eval") ||
      telemetryEvents.find((evt) => evt.payload?.subtype === "v1.1-governance-matrix");
    const validationEvent = telemetryEvents.find((evt) => evt.payload?.subtype === "v1.1-validation");

    expect(constraintEval).toBeTruthy();
    expect(matrixEval).toBeTruthy();
    expect(validationEvent).toBeTruthy();

    // Step E: Validate rule parsing + strictness telemetry
    const parsedRulesEvent = socket.emitted.find((evt) => evt.event === "parsed-rules");
    expect(parsedRulesEvent?.payload?.payload?.rules?.length || 0).toBeGreaterThan(0);

    const strictnessTelemetry =
      telemetryEvents.find((evt) => evt.payload?.subtype === "strictness") ||
      telemetryEvents.find((evt) => evt.payload?.subtype === "v1.1-governance-matrix");
    const strictnessData = strictnessTelemetry?.payload?.data || {};
    const strictnessLevel =
      typeof strictnessData.effectiveStrictness === "number"
        ? strictnessData.effectiveStrictness
        : typeof strictnessData.base === "number"
        ? strictnessData.base
        : typeof strictnessData.strictness === "number"
        ? strictnessData.strictness
        : strictnessData.base?.level ?? 0;
    expect(strictnessLevel).toBeGreaterThanOrEqual(1);

    // Delivery failures should remain empty for a healthy test harness run.
    const deliveryFailureEvent = socket.emitted.find((evt) => evt.event === "delivery-failure");
    expect(deliveryFailureEvent).toBeUndefined();
  });
});
