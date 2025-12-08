const assert = require("assert");

const { classifyGovernanceRequest } = require("../workflow/governanceClassifier");
const { REQUEST_TYPES } = require("../workflow/governanceConstants");

const basePrompts = [
  "Draft a HIPAA-compliant summary for the oncology program.",
  "Please draft HIPAA compliant summary for the oncology program.",
  "Could you draft, in a HIPAA safe way, the oncology program summary?",
  "Draft the oncology program summary with HIPAA alignment, thanks.",
  "For HIPAA compliance, draft the oncology program summary.",
];

basePrompts.forEach((prompt, idx) => {
  const result = classifyGovernanceRequest(prompt, { entrypoint: "deterministicRoutingTest" });
  assert.strictEqual(
    result.requestType,
    REQUEST_TYPES.GOVERNED,
    `[variant ${idx + 1}] expected GOVERNED but received ${result.requestType}`
  );
  assert.ok(
    result.governingFactors.some((factor) => factor.category === "sensitivity"),
    `[variant ${idx + 1}] expected sensitivity factor`
  );
});

console.log("deterministicRouting.test.js passed");
