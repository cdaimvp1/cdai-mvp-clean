// V1.1-PHASE5: dev-only smoke tests
async function runV1_1SmokeTests(simulate) {
  console.log("[V1.1 Smoke Tests] starting...");

  await simulate("conversational: hi thanks", {
    expectGoverned: false,
    expectDecision: "allow",
  });

  await simulate("governed: draft a contract", {
    expectGoverned: true,
  });

  await simulate("high-risk: finalize or execute the workflow", {
    expectDecision: "ask_clarification",
  });

  console.log("[V1.1 Smoke Tests] complete.");
}

module.exports = { runV1_1SmokeTests };
