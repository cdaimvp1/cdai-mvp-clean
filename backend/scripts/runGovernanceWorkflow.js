#!/usr/bin/env node
/**
 * CLI harness to exercise the governed workflow and print diagnostics.
 */

process.env.ALLOW_OPENAI_STUB = "1";
process.env.NODE_ENV = process.env.NODE_ENV || "test";

const { runGovernedWorkflow } = require("../workflow/runGovernedWorkflow");
const { DATA_SCOPE_MODES } = require("../workflow/governanceConstants");
const { createMockSocket } = require("../tests/harness/mockSocket");
const { installMockOpenAIStub } = require("../tests/harness/mockOpenAI");
const rules = require("../tests/fixtures/rules.json");

const PASS_MAP = {
  Analytical: "A",
  Moderator: "M1",
  "Moderator-2": "M2",
  Creative: "C",
  Validator: "V",
};

function formatSequence(events) {
  return events
    .filter((evt) => evt.event === "cycle-state" && evt.payload?.phase === "exit")
    .map((evt) => PASS_MAP[evt.payload.stage] || evt.payload.stage)
    .join(" → ");
}

function collectTelemetry(socket, subtype) {
  return socket.emitted.filter(
    (evt) => evt.event === "telemetry" && evt.payload?.subtype === subtype
  );
}

async function main() {
  const restoreFetch = installMockOpenAIStub();
  try {
    const socket = createMockSocket();
    const ledger = [];
    runGovernedWorkflow._inFlight = false;

    await runGovernedWorkflow(socket, {
      input: "Draft me a 3-step project plan for migrating a database.",
      goal: "Harness CLI verification",
      governanceStrictness: 0.95,
      dataScopeMode: DATA_SCOPE_MODES.WORK,
      governanceEnvelope: {
        requiresGovernedOutput: true,
        constraints: [{ type: "hard_block", sourceRuleId: "HARNESS-RULE" }],
      },
      sessionId: `harness-cli-${Date.now()}`,
      runId: "harness-cli",
      baseLedger: ledger,
      rules,
    });

    const passSequence = formatSequence(socket);
    const matrixEvents =
      collectTelemetry(socket, "v1.2-matrix-eval") ||
      collectTelemetry(socket, "v1.1-governance-matrix");
    const strictnessEvents = collectTelemetry(socket, "strictness");
    const parsedRules = socket.emitted.find((evt) => evt.event === "parsed-rules");
    const governedOutput = socket.emitted
      .filter((evt) => evt.event === "governed-output")
      .pop();

    console.log("PASS SEQUENCE");
    console.log(passSequence ? `${passSequence} → COMPLETE` : "No pass events recorded.");

    console.log("\nGOVERNANCE EFFECTS");
    console.log(`- Rules loaded: ${parsedRules?.payload?.payload?.rules?.length || 0}`);
    console.log(
      `- Matrix evaluations: ${
        (matrixEvents || []).length
          ? matrixEvents.map((evt) => evt.payload?.data?.decision || "n/a").join(", ")
          : "none"
      }`
    );
    const finalText = governedOutput?.payload?.payload?.text || "";
    console.log(
      `- Governance notice present: ${finalText.includes("[Governance Notice") ? "yes" : "no"}`
    );

    console.log("\nRUNTIME HEALTH");
    const missingPasses = passSequence ? [] : ["passes"];
    console.log(`- Missing emit checks: ${missingPasses.length ? missingPasses.join(", ") : "none"}`);
    console.log(`- Ledger entries captured: ${ledger.length}`);
    console.log(`- Telemetry events: ${socket.emitted.filter((e) => e.event === "telemetry").length}`);

    console.log("\nSTRICTNESS VALIDATION");
    const strictnessLevel =
      strictnessEvents[0]?.payload?.data?.effectiveStrictness?.level ??
      strictnessEvents[0]?.payload?.data?.base?.level ??
      0;
    console.log(`- Effective strictness level: ${strictnessLevel}`);
    console.log(
      `- Final output snippet: ${
        finalText ? finalText.slice(0, 140).replace(/\s+/g, " ") : "n/a"
      }`
    );
  } finally {
    restoreFetch();
  }
}

main().catch((err) => {
  console.error("[harness] Governance workflow failed", err);
  process.exit(1);
});
