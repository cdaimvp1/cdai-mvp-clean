const { DATA_SCOPE_MODES, DEFAULT_DATA_SCOPE_MODE } = require("./governanceConstants");
const { getModeCapabilities } = require("./runtimeConfig");

// V1.2-PHASE5-FIX: shared normalization helper for session + tests
function normalizeMode(mode) {
  if (typeof mode !== "string") return null;
  const normalized = mode.toLowerCase();
  if (Object.values(DATA_SCOPE_MODES).includes(normalized)) {
    return normalized;
  }
  return null;
}

function emitModeChangeTelemetry(socket, state, mode, timestamp) {
  const sessionId = state?.id || state?.sessionId || socket?.id || null;
  const payload = {
    type: "telemetry",
    subtype: "v1.2-mode-change",
    sessionId,
    data: {
      event: "v1.2-mode-change",
      mode,
      timestamp,
    },
  };
  if (socket?.server?.to && sessionId) {
    socket.server.to(sessionId).emit("telemetry", payload);
  } else {
    socket?.emit?.("telemetry", payload);
  }
}

// V1.2-PHASE5-FIX: centralize backend mode-change handling for runtime + tests
function handleDataScopeModeChange(state, socket, requestedMode, now = Date.now()) {
  if (!state || !socket) {
    return { updated: false, reason: "missing_state_or_socket" };
  }
  if (state.pendingClarification) {
    socket.emit("governance-error", {
      type: "mode-change-blocked",
      message: "Cannot change Data Scope Mode during clarification.",
    });
    return { updated: false, reason: "pending_clarification" };
  }
  const normalized = normalizeMode(requestedMode);
  if (!normalized) {
    return { updated: false, reason: "invalid_mode" };
  }
  state.dataScopeOverride = true;
  state.dataScopeMode = normalized || DEFAULT_DATA_SCOPE_MODE; // V1.2-PHASE5-FIX: persist normalized scope mode
  const capabilities = getModeCapabilities(state.dataScopeMode);
  state.allowedSources = capabilities.allowedSources;
  state.allowWeb = capabilities.allowWeb;
  state.provenanceMode = capabilities.provenanceMode;
  const sessionId = state.id || socket.id;
  const timestamp = now;
  socket.emit("data-scope-mode-updated", { mode: normalized, timestamp });
  socket.emit("governance-notice", {
    type: "mode-change",
    message: `Data Scope Mode changed to: ${state.dataScopeMode}`,
  });
  emitModeChangeTelemetry(socket, { ...state, id: sessionId }, normalized, timestamp);
  return { updated: true, mode: normalized, timestamp };
}

module.exports = {
  handleDataScopeModeChange,
  normalizeMode,
};
