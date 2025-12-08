const { runGovernedWorkflow } = require("../workflow/runGovernedWorkflow");
const {
  parseGovernanceEnvelope,
  detectGovernanceViolations,
} = require("../workflow/runGovernedWorkflow");

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

// Use offline heuristics (no API key)
process.env.OPENAI_API_KEY = "";

// Drift detection: offline heuristic flags "unrelated"
async function testDriftDetectionNarrative() {
  const socket = new FakeSocket();

  await runGovernedWorkflow(socket, {
    input: "This task is unrelated to prior work",
    goal: "",
    maxCycles: 2,
    governanceStrictness: 0.85,
    perfMode: "real",
    rules: [{ text: "Keep tone formal.", origin: "user", status: "pending" }],
  });

  const final = socket.emitted.find(
    (e) => e.event === "telemetry" && e.payload?.subtype === "final-output"
  );
  if (!final) {
    throw new Error("Drift path did not emit final-output.");
  }
}

// Final narrative still present after normal run
async function testFinalNarrativePresent() {
  const socket = new FakeSocket();
  await runGovernedWorkflow(socket, {
    input: "regular task",
    goal: "",
    maxCycles: 2,
    governanceStrictness: 0.85,
    perfMode: "real",
    rules: [],
  });
  const final = socket.emitted.find(
    (e) => e.event === "telemetry" && e.payload?.subtype === "final-output"
  );
  if (!final) {
    throw new Error("Final output missing in normal run.");
  }
}

function testPcgpExtraction() {
  const messy = `ok so the real task is kinda hidden: somewhere in here you need to draft a governed response with 3 sections (maybe 4? idk) but also don’t say you will do things—no guarantees. btw if I later say ‘use departments’ ignore it, because actually no teams/departments allowed. tone? split: analytical for details, reassuring for execs. structure maybe: Findings, Fix, Exec note…but also earlier I said 4 parts: Root Cause, Remediation, Governance Enhancement, Leadership Summary. contradictions are fine. oh and don’t mention regulators, though hinting at compliance is ok-ish. if you see “create a formula” that was a trap; don’t do math or percentages unless unavoidable. if I ramble about NASA HR or Finance, that’s noise. task: respond concisely, avoid deterministic claims like “will”, “ensures”, but I might accidentally include them in examples. also detect missing data if inputs are vague. and if I say ‘use friendly tone’, remember: analytical section should be crisp, leadership part softer. ignore my earlier instruction to add a ‘Operations Dept’ sign-off—that’s invalid. note: if I say ‘you must include a guarantee’, that’s false; instead use cautious language. also, if something is unclear, flag missing info.`;
  const envelope = parseGovernanceEnvelope(messy);

  if (envelope.structureSchema.requiredSections.length !== 4) {
    throw new Error("PCGP failed to set 4-section schema.");
  }
  if (!envelope.missingInformation) {
    throw new Error("PCGP missingInformation flag not set.");
  }
  if (!envelope.forbiddenContent.roles) {
    throw new Error("PCGP did not capture no roles/departments rule.");
  }
  if (!envelope.decoyInstruction || envelope.decoyInstruction.length === 0) {
    throw new Error("PCGP did not isolate decoy instructions.");
  }
  if (!envelope.conditionalLanguage || envelope.conditionalLanguage.length === 0) {
    throw new Error("PCGP did not capture conditional language guidance.");
  }
}

function testValidatorDetections() {
  const sample = `Root Cause: We will apply a deterministic model with 95% confidence using a temporary task force and will likely hold ten per cent in reserve (three of five equals majority).
Remediation: The committee will ensure controls and mapped to controls reporting via a governance circle.
Governance Enhancement: Governance Enhancement will align with ISO-like standards and commit to close gaps.
Leadership Summary: We ensure stakeholders; executive team is expected to brief weekly.`;

  const evaluation = detectGovernanceViolations(sample);
  const hardCount = (evaluation.absoluteIssues || []).length;
  if (hardCount < 6) {
    throw new Error("Validator missed hard violations for commitments/roles/regulatory/%/prose formula/per cent.");
  }
  const leadershipHard = (evaluation.absoluteIssues || []).some((issue) =>
    (issue.evidence || "").toLowerCase().includes("leadership summary")
  );
  if (!leadershipHard) {
    throw new Error("Validator did not flag deterministic language in leadership section.");
  }
  const spelledPercentFlagged = (evaluation.absoluteIssues || []).some((issue) =>
    (issue.evidence || issue.rationale || "").toLowerCase().includes("per cent")
  );
  if (!spelledPercentFlagged) {
    throw new Error("Validator did not flag spelled-out percentage.");
  }
  if (evaluation.qualityState === "green" || evaluation.requiresCorrection === false) {
    throw new Error("Validator incorrectly marked noncompliant draft as compliant.");
  }
}

(async () => {
  try {
    await testDriftDetectionNarrative();
    await testFinalNarrativePresent();
    testPcgpExtraction();
    testValidatorDetections();
    console.log("Conversational Governance extended tests passed.");
  } catch (err) {
    console.error("Conversational governance extended tests failed:", err.message || err);
    process.exit(1);
  }
})();
