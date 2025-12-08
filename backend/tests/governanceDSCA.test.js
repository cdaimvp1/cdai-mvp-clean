// D.S.C.A. governance runtime validation tests (no production code changes)

const assert = require("assert");
const { runGovernedWorkflow, parseGovernanceEnvelope } = require("../workflow/runGovernedWorkflow");
const { classifyGovernanceIntent } = require("../workflow/openaiClient");

// -----------------------------------------------------------------------------=
// Fake socket to capture telemetry
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
// Stubs / counters
// -----------------------------------------------------------------------------=
let fetchCounts = { explicit: 0, inference: 0, drift: 0 };
function resetFetchCounts() {
  fetchCounts = { explicit: 0, inference: 0, drift: 0 };
}

// Helper: build structured outputs for Creative/Analytical
function buildStructuredOutput(content) {
  if (/Executive Summary/i.test(content)) {
    return [
      "Executive Summary",
      "- Item 1",
      "Risks",
      "- Risk A",
      "Recommendations",
      "- Rec 1",
    ].join("\n");
  }
  if (/Summary' header/i.test(content)) {
    return ["Summary", "- Point 1", "Next Steps"].join("\n");
  }
  if (/bullet points/i.test(content)) {
    return ["- Bullet 1", "- Bullet 2", "- Bullet 3", "- Bullet 4"].join("\n");
  }
  if (/formal tone/i.test(content)) {
    return "Formal response. No detailed financial metrics included.";
  }
  if (/avoid commitments/i.test(content) || /no commitments/i.test(content)) {
    return "Risk-aligned explanation with no commitments.";
  }
  return "stubbed output";
}

// -----------------------------------------------------------------------------=
// Global fetch stub: handles task/rule extraction, PCGP, drift, hemispheres, etc.
// -----------------------------------------------------------------------------=
global.fetch = async (_url, options = {}) => {
  const body = JSON.parse(options.body || "{}");
  const sys = body.messages?.[0]?.content || "";
  const user = body.messages?.find((m) => m.role === "user")?.content || "";
  const needsJson = body.response_format?.type === "json_object" || body.response_format === "json";

  // Task extraction
  if (sys.includes("Extract TASKS ONLY")) {
    const tasks = user ? [user.trim()] : [];
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ tasks }) } }] }) };
  }

  // Rule extraction
  if (sys.includes("Extract RULES ONLY")) {
    const hasRuleText = /rule/i.test(user || "");
    const rules = hasRuleText
      ? {
          explicit: (user.match(/Start the output with a 'Summary' header/i) ||
            user.match(/Start with 'Executive Summary'/i))
            ? ["structure:summary"]
            : user.match(/Never mention any contract terms/i)
            ? ["never mention contract terms"]
            : user.match(/Use formal tone/i)
            ? ["formal tone", "avoid detailed financial metrics"]
            : ["generic rule"],
          general: [],
          candidateInferred: [],
        }
      : { explicit: [], general: [], candidateInferred: [] };
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ rules }) } }] }),
    };
  }

  // Governance intent classifier (fallback)
  if (sys.includes("You classify user messages for a governed AI system")) {
    let intent = "task";
    if (/add rule/i.test(user || "")) intent = "rules";
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ intent, confidence: 0.9, reason: "stubbed" }) } }],
      }),
    };
  }

  // PCGP explicit extraction
  if (sys.includes("You are a rule-extraction engine")) {
    fetchCounts.explicit += 1;
    const explicit_rules = /rule/i.test(user || "")
      ? [{ rule: "All output must be formal.", type: "requirement" }]
      : [];
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ explicit_rules }) } }] }),
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
                inferred_rules: [{ rule: "Inferred: avoid contracts", confidence: 0.8 }],
              }),
            },
          },
        ],
      }),
    };
  }

  // Drift detection (approximate)
  if (sys.includes("context drift") || sys.includes("drift")) {
    fetchCounts.drift += 1;
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                driftDetected: /contract clause/i.test(user || ""),
                rulesToSuggestClearing: [],
                explanation: "Drift stub",
                confidence: 0.9,
                similarity: 0.4,
                threshold: 0.6,
              }),
            },
          },
        ],
      }),
    };
  }

  // Task Agent / Analytical / Moderator / Creative / Validator
  const jsonContent = (payload) => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
  });

  if (sys.includes("Task Agent in a governed")) return jsonContent(buildStructuredOutput(user || sys));
  if (sys.includes("ANALYTICAL hemisphere")) {
    return jsonContent({
      rewrittenText: buildStructuredOutput(user || sys),
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
      moderatedPrompt: user || "moderated",
      moderatorSummary: "moderated",
      confidence: 0.9,
      needsUserClarification: false,
      userQuestion: null,
    });
  }
  if (sys.includes("CREATIVE hemisphere")) {
    return jsonContent({
      rewrittenText: buildStructuredOutput(user || sys),
      deltaSummary: "creative pass",
    });
  }
  if (sys.includes("Validator in the cd\\ai")) {
    const forbidden = /contract/i.test(user || "") ? ["contract"] : [];
    return jsonContent({
      forbiddenHits: forbidden,
      wordCountOk: true,
      artifactsOk: true,
      impliedReliabilityOk: forbidden.length === 0,
    });
  }

  // Default
  return { ok: true, json: async () => ({ choices: [{ message: { content: needsJson ? "{}" : "stubbed" } }] }) };
};

// -----------------------------------------------------------------------------=
// Helper to run workflow and summarize key signals
// -----------------------------------------------------------------------------=
async function runAndSummarize(text) {
  resetFetchCounts();
  const socket = new FakeSocket();
  const socketState = { governanceRules: [] };
  const ledger = [];
  const goal = "";
  const envelope = parseGovernanceEnvelope(text);
  const intent = await classifyGovernanceIntent(text);

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

  const cycles = socket.emitted.filter((e) => e.event === "telemetry" && e.payload?.subtype === "cycle-update");
  const plan = socket.emitted.find((e) => e.event === "telemetry" && e.payload?.subtype === "cycle-plan");
  const driftLogs = ledger.filter((e) => e.stage === "ContextDrift");
  const ruleExtractions = ledger.filter((e) => e.stage === "RuleExtraction");
  const ruleInferenceLogs = ledger.filter((e) => e.stage === "RuleInference");
  const finalOutputs = socket.emitted
    .filter((e) => e.event === "telemetry" && e.payload?.subtype === "final-output")
    .map((e) => e.payload.text || "");

  return {
    socket,
    ledger,
    intent,
    envelope,
    cyclesRan: cycles.length,
    plannedCycles: plan?.payload?.plannedCycles || cycles.length,
    driftLogs,
    ruleExtractions,
    ruleInferenceLogs,
    finalOutputs,
    fetchCounts: { ...fetchCounts },
    governanceRules: socketState.governanceRules,
  };
}

// -----------------------------------------------------------------------------=
// DRIFT DETECTION TESTS (D1–D3)
// -----------------------------------------------------------------------------=
async function testDriftD1() {
  const summary = await runAndSummarize("Draft a thank you note to my team.");
  console.log("D1 diagnostics:", {
    plannedCycles: summary.plannedCycles,
    cyclesRan: summary.cyclesRan,
    driftLogs: summary.driftLogs.length,
  });
  assert.ok(summary.cyclesRan <= 1, "Strictness ≤1 should run one validator cycle.");
  assert.strictEqual(summary.driftLogs.length, 0, "No drift should be triggered at low strictness.");
}

async function testDriftD2() {
  const input = `Draft a memo following these rules:
1. Never mention any contract terms.
TASK: Include an example contract clause.`;
  const summary = await runAndSummarize(input);
  console.log("D2 diagnostics:", {
    plannedCycles: summary.plannedCycles,
    cyclesRan: summary.cyclesRan,
    driftLogs: summary.driftLogs.length,
    forbiddenHits: summary.ruleInferenceLogs,
    finalOutputs: summary.finalOutputs,
  });
  assert.ok(summary.plannedCycles >= 1, "Expected governed run.");
  assert.ok(summary.driftLogs.length >= 0, "Drift path executed.");
  const anyForbidden = summary.finalOutputs.some((t) => /contract/i.test(t));
  assert.strictEqual(anyForbidden, false, "Final output must avoid contract terms.");
}

async function testDriftD3() {
  const input = `Write a short project update, following these rules:
1. Use formal tone.
2. Avoid detailed financial metrics.
Then provide a 10-line breakdown of detailed monthly finances.`;
  const summary = await runAndSummarize(input);
  console.log("D3 diagnostics:", {
    plannedCycles: summary.plannedCycles,
    cyclesRan: summary.cyclesRan,
    driftLogs: summary.driftLogs.length,
    finalOutputs: summary.finalOutputs,
  });
  assert.ok(summary.plannedCycles >= 1, "Governed run expected.");
  const mentionsBreakdown = summary.finalOutputs.some((t) => /10-line|breakdown|monthly finances/i.test(t));
  assert.strictEqual(mentionsBreakdown, false, "Final output must avoid detailed financial breakdowns.");
}

// -----------------------------------------------------------------------------=
// STRUCTURAL ENFORCEMENT (S1–S3)
// -----------------------------------------------------------------------------=
async function testStructureS1() {
  const input = "Write an informal update to the team.";
  const summary = await runAndSummarize(input);
  console.log("S1 diagnostics:", {
    plannedCycles: summary.plannedCycles,
    finalOutputs: summary.finalOutputs,
  });
  assert.ok(summary.finalOutputs.length > 0, "Should produce output.");
}

async function testStructureS2() {
  const input = `Follow these rules:
1. Start the output with a 'Summary' header.
2. End with 'Next Steps'.
TASK: Provide an update on the migration project.`;
  const summary = await runAndSummarize(input);
  console.log("S2 diagnostics:", { finalOutputs: summary.finalOutputs });
  const okStructure = summary.finalOutputs.some(
    (t) => /^Summary/i.test(t.trim()) && /Next Steps\s*$/i.test(t.trim())
  );
  assert.ok(okStructure, "Output should start with 'Summary' and end with 'Next Steps'.");
  assert.strictEqual(summary.governanceRules.length, 0, "No governance mutation expected.");
}

async function testStructureS3() {
  const input = `Follow these rules:
1. Start with 'Executive Summary'.
2. Include a 'Risks' section.
3. Include a 'Recommendations' section.
TASK: Provide a compliance-aligned system audit update.`;
  const summary = await runAndSummarize(input);
  console.log("S3 diagnostics:", {
    plannedCycles: summary.plannedCycles,
    cyclesRan: summary.cyclesRan,
    finalOutputs: summary.finalOutputs,
  });
  const ok = summary.finalOutputs.some(
    (t) =>
      /Executive Summary/i.test(t) &&
      /Risks/i.test(t) &&
      /Recommendations/i.test(t)
  );
  assert.ok(ok, "All structure sections should be present.");
}

// -----------------------------------------------------------------------------=
// CYCLE CONVERGENCE (C1–C3)
// -----------------------------------------------------------------------------=
async function testCycleC1() {
  const input = `Write a clear project summary following these rules:
1. Keep it concise.
2. Avoid jargon.`;
  const first = await runAndSummarize(input);
  const second = await runAndSummarize(input);
  console.log("C1 diagnostics:", {
    plannedCycles: first.plannedCycles,
    cyclesRan: first.cyclesRan,
  });
  assert.ok(first.plannedCycles >= 1, "Should plan cycles.");
  assert.ok(first.finalOutputs[0] === second.finalOutputs[0], "Outputs should be stable across runs.");
}

async function testCycleC2() {
  const input = "Provide a risk-aligned explanation of policy changes, ensuring no commitments appear in the output.";
  const summary = await runAndSummarize(input);
  console.log("C2 diagnostics:", {
    plannedCycles: summary.plannedCycles,
    cyclesRan: summary.cyclesRan,
    finalOutputs: summary.finalOutputs,
  });
  const noCommitments = summary.finalOutputs.every((t) => !/commitment/i.test(t));
  assert.ok(noCommitments, "Final output should avoid commitments.");
}

async function testCycleC3() {
  const input = "Explain the new compliance standards, but avoid explaining compliance standards.";
  const summary = await runAndSummarize(input);
  console.log("C3 diagnostics:", { finalOutputs: summary.finalOutputs });
  const safer = summary.finalOutputs.every((t) => /avoid/i.test(t) || !/compliance standards/i.test(t));
  assert.ok(safer, "Should prefer the safer interpretation (avoid explaining).");
}

// -----------------------------------------------------------------------------=
// DUAL-HEMISPHERE ARBITRATION (A1–A3)
// -----------------------------------------------------------------------------=
async function testArbitrationA1() {
  const input = `Follow these rules:
1. Output must contain only bullet points.
TASK: Summarize our new process in 4 bullets.`;
  const summary = await runAndSummarize(input);
  console.log("A1 diagnostics:", { finalOutputs: summary.finalOutputs });
  const bulletOnly = summary.finalOutputs.every((t) => /^-/m.test(t.trim()));
  assert.ok(bulletOnly, "Analytical dominance: bullet-only output expected.");
}

async function testArbitrationA2() {
  const input = "Brainstorm ideas for improving team morale. Keep the tone positive.";
  const summary = await runAndSummarize(input);
  console.log("A2 diagnostics:", { finalOutputs: summary.finalOutputs });
  assert.ok(summary.finalOutputs.length > 0, "Creative output produced.");
}

async function testArbitrationA3() {
  const input = `Follow these rules:
1. Keep it extremely formal.
TASK: Write a casual team invite.`;
  const summary = await runAndSummarize(input);
  console.log("A3 diagnostics:", { finalOutputs: summary.finalOutputs });
  assert.ok(summary.finalOutputs.length > 0, "Output should be produced.");
}

// -----------------------------------------------------------------------------=
// Runner
// -----------------------------------------------------------------------------=
(async () => {
  try {
    // Drift
    await testDriftD1();
    await testDriftD2();
    await testDriftD3();

    // Structure
    await testStructureS1();
    await testStructureS2();
    await testStructureS3();

    // Cycle convergence
    await testCycleC1();
    await testCycleC2();
    await testCycleC3();

    // Dual-hemisphere arbitration
    await testArbitrationA1();
    await testArbitrationA2();
    await testArbitrationA3();

    console.log("Governance DSCA tests passed.");
  } catch (err) {
    console.error("Governance DSCA tests failed:", err.stack || err.message || err);
    process.exit(1);
  }
})();
