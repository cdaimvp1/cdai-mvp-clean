process.env.ALLOW_OPENAI_STUB = "1";
const { runGovernedWorkflow } = require("../workflow/runGovernedWorkflow");
const { DATA_SCOPE_MODES } = require("../workflow/governanceConstants");
class FakeSocket {
  constructor(id = "probe") {
    this.id = id;
    this.emitted = [];
    this.listeners = {};
    this.server = null;
  }
  emit(event, payload) {
    this.emitted.push({ event, payload });
  }
}
const BASE_RULE = { text: "Operate safely; document decisions.", origin: "user" };
const CITATION_RULE = { text: "When using public/web data you must cite all public sources.", origin: "user" };
const PROVENANCE_RULE = { text: "Track provenance for all external/public content.", origin: "user" };

async function captureTrace({ input, mode, rules, creativeOutput }) {
  const socket = new FakeSocket();
  await runGovernedWorkflow(socket, {
    input,
    goal: "",
    maxCycles: null,
    governanceStrictness: 0.9,
    perfMode: "real",
    requiresGovernedOutput: true,
    rules,
    sessionId: socket.id,
    runId: `${mode}-trace-${Date.now()}`,
    dataScopeMode: mode,
  });
  const traces = socket.emitted
    .filter((e) => e.event === "telemetry" && e.payload?.subtype === "v1.1-canonical-trace")
    .map((e) => e.payload?.data?.trace || e.payload?.data)
    .filter(Boolean);
  return traces.pop();
}

(async () => {
  const webTrace = await captureTrace({
    input: "draft governed memo referencing web data",
    mode: DATA_SCOPE_MODES.WEB,
    rules: [BASE_RULE, CITATION_RULE, PROVENANCE_RULE],
    creativeOutput: "According to https://example.com governance",
  });
  const workTrace = await captureTrace({
    input: "draft internal memo",
    mode: DATA_SCOPE_MODES.WORK,
    rules: [BASE_RULE],
    creativeOutput: "Internal memo",
  });
  console.log(JSON.stringify({ webTrace, workTrace }, null, 2));
})();
