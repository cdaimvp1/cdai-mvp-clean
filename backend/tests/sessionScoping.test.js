// RULE SCOPING FIX: ensure rule events are session-scoped (include sessionId)

const assert = require("assert");
const { runGovernedWorkflow } = require("../workflow/runGovernedWorkflow");

class FakeSocket {
  constructor(id = "fake-socket") {
    this.id = id;
    this.emitted = [];
  }
  emit(event, payload) {
    this.emitted.push({ event, payload });
  }
}

// Minimal fetch stub to satisfy OpenAI chat calls
global.fetch = async (_url, _opts = {}) => ({
  ok: true,
  json: async () => ({
    choices: [{ message: { content: JSON.stringify({ rewrittenText: "draft", deltaSummary: "d" }) } }],
  }),
});

describe("Session-scoped rule emissions", () => {
  it("emits parsed-rules with sessionId", async () => {
    const socket = new FakeSocket("sock-1");
    runGovernedWorkflow._inFlight = false;

    await runGovernedWorkflow(socket, {
      input: "Draft an update",
      rules: ["rule a"],
      perfMode: "turbo",
      sessionId: "sess-123",
    });

    const parsed = socket.emitted.find((e) => e.event === "parsed-rules");
    assert(parsed, "expected parsed-rules event");
    const p = parsed.payload || {};
    const rules = p.payload?.rules || p.rules || [];
    assert.strictEqual(p.sessionId, "sess-123");
    assert.strictEqual(rules.length, 1);
  });
});
