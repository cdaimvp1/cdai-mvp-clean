// debug/eventHarness.js
// Debug-only event verification harness for Socket.IO events.
// Activate with DEBUG_EVENTS=true

const expectedEvents = [
  "governed-output",
  "ungoverned-output",
  "mcp-status",
  "hemisphere-log",
  "moderator-log",
  "creative-log",
  "validator-log",
  "parsed-rules",
  "rules-cleared",
  "ledger",
  "ledger-entry",
  "ledger-updated",
  "chat-message",
  "system-message",
];

const eventCounts = {};
const payloadShapes = {};
let lastCycleMissing = [];

function formatShape(payload) {
  if (!payload || typeof payload !== "object") return "---";
  if (Array.isArray(payload)) return "array";
  return Object.keys(payload).join(",") || "---";
}

function printDebugTable() {
  const header =
    "---------------------------------------------------------\n" +
    "EVENT NAME              COUNT   PAYLOAD SHAPE\n" +
    "---------------------------------------------------------";

  const rows = Object.keys(eventCounts)
    .sort()
    .map((evt) => {
      const count = eventCounts[evt] || 0;
      const shape = payloadShapes[evt] || "---";
      return `${evt.padEnd(23)} ${String(count).padEnd(6)} ${shape}`;
    });

  const missing = lastCycleMissing.length
    ? "\n[WARNING] Expected event(s) not fired during last cycle: " +
      lastCycleMissing.join(", ")
    : "";

  // eslint-disable-next-line no-console
  console.debug([header, ...rows, "---------------------------------------------------------", missing].join("\n"));
}

function checkCycleExpectations() {
  const mustFire = [
    "mcp-status",
    "hemisphere-log",
    "moderator-log",
    "creative-log",
    "validator-log",
    "ledger",
    "governed-output",
  ];
  lastCycleMissing = mustFire.filter((evt) => !eventCounts[evt]);
  if (lastCycleMissing.length) {
    // eslint-disable-next-line no-console
    console.warn(
      "[WARNING] Expected event not fired during last cycle:",
      lastCycleMissing.join(", ")
    );
  }
}

function attachHarness(io) {
  if (!io) return;

  // Track any event name observed to widen coverage dynamically.
  io.on("connection", (socket) => {
    // Dynamically capture all events
    const allEvents = new Set(expectedEvents);

    socket.onAny((evt, payload) => {
      allEvents.add(evt);
      eventCounts[evt] = (eventCounts[evt] || 0) + 1;
      payloadShapes[evt] = formatShape(payload);

      // Payload mismatch detection (basic): for known events, expect minimal keys.
      if (evt === "parsed-rules") {
        const expectedKeys = ["rules"];
        const gotKeys = Object.keys(payload || {});
        if (gotKeys.sort().join(",") !== expectedKeys.sort().join(",")) {
          console.error(
            "[ERROR] Payload mismatch for parsed-rules:",
            "Expected keys:",
            expectedKeys.join(","),
            "Got keys:",
            gotKeys.join(",")
          );
        }
      }

      printDebugTable();
    });

    // Periodic cycle expectation check after each disconnect (approx per session)
    socket.on("disconnect", () => {
      checkCycleExpectations();
    });
  });
}

function debugRoute(app) {
  if (!app) return;
  app.get("/debug/events", (_req, res) => {
    res.json({
      eventCounts,
      payloadShapes,
      lastCycleMissing,
      trackedEvents: Object.keys(eventCounts),
    });
  });
}

module.exports = {
  attachHarness,
  debugRoute,
};
