const assert = require("assert");

const { classifyGovernanceRequest } = require("../workflow/governanceClassifier");
const { REQUEST_TYPES } = require("../workflow/governanceConstants");

const cases = [
  {
    name: "Detects PHI sensitivity",
    input: "Summarize the patient medical record and ensure HIPAA compliance.",
    expectedType: REQUEST_TYPES.GOVERNED,
    minStrictness: 2,
    expectSimulation: false,
  },
  {
    name: "Flags architecture/system blueprint work",
    input: "Design an internal zero-trust architecture for our finance systems.",
    expectedType: REQUEST_TYPES.GOVERNED,
    minStrictness: 1,
  },
  {
    name: "Identifies workflow orchestration",
    input: "Build a multi-agent workflow and runbook for the MCP orchestrator.",
    expectedType: REQUEST_TYPES.GOVERNED,
    minStrictness: 1,
  },
  {
    name: "Captures data governance requests",
    input: "Draft a data retention and classification policy for M&A artifacts.",
    expectedType: REQUEST_TYPES.GOVERNED,
    minStrictness: 1,
  },
  {
    name: "Applies safety envelope triggers",
    input: "Approve the release plan and send customer datasets externally.",
    expectedType: REQUEST_TYPES.GOVERNED,
    minStrictness: 2,
  },
  {
    name: "Handles informational question as ungoverned",
    input: "What is the capital of France?",
    expectedType: REQUEST_TYPES.UNGOVERNED,
    minStrictness: 0,
  },
  {
    name: "Treats pleasantries as ungoverned",
    input: "Thanks!",
    expectedType: REQUEST_TYPES.UNGOVERNED,
    minStrictness: 0,
  },
  {
    name: "Detects simulation context",
    input: "Simulate a fictional HIPAA audit scenario for patient portals.",
    expectedType: REQUEST_TYPES.GOVERNED,
    minStrictness: 2,
    expectSimulation: true,
  },
  {
    name: "Falls back to unknown when no signals exist",
    input: "",
    expectedType: REQUEST_TYPES.UNKNOWN,
    minStrictness: 1,
  },
  {
    name: "Compliance questions remain governed per blueprint",
    input: "Explain GDPR audit controls for export compliance.",
    expectedType: REQUEST_TYPES.GOVERNED,
    minStrictness: 2,
  },
];

cases.forEach((testCase) => {
  const result = classifyGovernanceRequest(testCase.input, { entrypoint: "governanceClassifier.test" });
  assert.strictEqual(
    result.requestType,
    testCase.expectedType,
    `[${testCase.name}] expected ${testCase.expectedType}, received ${result.requestType}`
  );
  assert.ok(
    result.governingFactors && Array.isArray(result.governingFactors) && result.governingFactors.length > 0,
    `[${testCase.name}] expected governing factors to be present`
  );
  assert.ok(
    result.requiredStrictness && typeof result.requiredStrictness.level === "number",
    `[${testCase.name}] expected strictness metadata`
  );
  if (testCase.expectedType === REQUEST_TYPES.GOVERNED) {
    assert.ok(
      result.requiredStrictness.level >= (testCase.minStrictness || 1),
      `[${testCase.name}] expected strictness >= ${testCase.minStrictness || 1}`
    );
  }
  if (testCase.expectedType === REQUEST_TYPES.UNGOVERNED) {
    assert.strictEqual(
      result.requiredStrictness.level,
      0,
      `[${testCase.name}] ungoverned requests should have strictness 0`
    );
  }
  if (typeof testCase.expectSimulation === "boolean") {
    assert.strictEqual(
      result.simulationFlag,
      testCase.expectSimulation,
      `[${testCase.name}] simulation flag mismatch`
    );
  }
});

console.log("governanceClassifier.test.js passed");
