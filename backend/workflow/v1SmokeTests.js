// V1-PHASE6: dev-only smoke tests (not for production use)
async function runV1SmokeTests(simulateRequestFn) {
  console.log("[V1 SmokeTests] Starting...");

  await simulateRequestFn({
    description: "conversational small talk",
    input: "hey thanks, that makes sense",
    expected: { governed: false },
  });

  await simulateRequestFn({
    description: "governed action, no rules",
    input: "draft a compliant sourcing decision memo",
    expected: { decision: "require_rules" },
  });

  await simulateRequestFn({
    description: "blocked governed action",
    input: "execute the decision in production",
    expected: { decision: "block" },
  });

  console.log("[V1 SmokeTests] Completed.");
}

module.exports = { runV1SmokeTests };
