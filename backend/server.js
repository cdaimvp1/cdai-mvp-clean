require("dotenv").config();

const path = require("path");
const http = require("http");
const express = require("express");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const { Server } = require("socket.io");

const {
  runGovernedWorkflow,
  parseGovernanceEnvelope,
  resumeFromClarification,
} = require("./workflow/runGovernedWorkflow");
// V1-PHASE1C: checkpoint restore import
const { restoreCycleState } = require("./workflow/mcpPhase1A");
// V1-PHASE2: governance scaffolding imports
const { computeStrictness } = require("./workflow/mcpPhase1A");
const { classifyGovernanceRequest } = require("./workflow/governanceClassifier");
const {
  REQUEST_TYPES,
  DATA_SCOPE_MODES,
  DEFAULT_DATA_SCOPE_MODE,
  GOVERNANCE_MODES,
} = require("./workflow/governanceConstants");
const { VOLUME_1_STATUS } = require("./workflow/v1Status");
const { VOLUME_1_1_STATUS } = require("./workflow/v1_1Status");
const { classifyGovernanceIntent } = require("./workflow/openaiClient");
const { attachHarness, debugRoute } = require("./debug/eventHarness");
const { handleDataScopeModeChange } = require("./workflow/dataScopeModeHandler"); // V1.2-PHASE5-FIX
const {
  runtimeConfig,
  setRuntimeMode,
  getModeCapabilities,
  computeDynamicStrictness,
  deriveRequestSignals,
  strictnessLabelToValue,
} = require("./workflow/runtimeConfig");
const {
  ensureAdminUser,
  verifyUserCredentials,
  getUserProfile,
} = require("./src/auth/userStore");

const app = express();
const SESSION_SECRET = process.env.CDAI_SESSION_SECRET || process.env.SESSION_SECRET || "cdai-dev-secret";
const SESSION_COOKIE = process.env.CDAI_SESSION_COOKIE || "cdai.sid";
const allowedSocketOrigins = (process.env.CDAI_SOCKET_ORIGINS || "http://localhost:5173,http://localhost:5006")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const sessionMiddleware = session({
  name: SESSION_COOKIE,
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 8,
  },
});

app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedSocketOrigins.length ? allowedSocketOrigins : "*",
    credentials: true,
  },
});
io.use((socket, next) => {
  sessionMiddleware(socket.request, socket.request.res || {}, (err) => {
    if (err) return next(err);
    if (socket.request.session?.user) {
      socket.user = socket.request.session.user;
      return next();
    }
    return next(new Error("unauthorized"));
  });
});

const socketStates = new Map();
const pendingClarifications = new Map(); // HITL LOOP FIX

const SIMPLE_MESSAGE_MAX_LENGTH = 80;
const SIMPLE_MESSAGE_MAX_WORDS = 12;
const SIMPLE_DISALLOWED_TOKENS = [
  "generate",
  "create",
  "draft",
  "produce",
  "run",
  "build",
  "design",
  "simulate",
  "workflow",
  "governance",
  "rule",
  "rules",
  "constraint",
  "constraints",
  "ledger",
  "panel",
  "diagnostic",
  "validator",
  "moderator",
  "analytical",
  "agent",
  "mcp",
  "telemetry",
];

function isSimpleConversationalMessage(text = "") {
  const normalized = (text || "").trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.length > SIMPLE_MESSAGE_MAX_LENGTH) return false;
  if (normalized.split(/\s+/).length > SIMPLE_MESSAGE_MAX_WORDS) return false;
  if (SIMPLE_DISALLOWED_TOKENS.some((token) => normalized.includes(token))) {
    return false;
  }
  return true;
}

function buildSimpleConversationalReply(text = "") {
  const normalized = (text || "").trim().toLowerCase();
  if (!normalized) {
    return "Hi there! Let me know how I can help.";
  }
  if (/(^|\b)(hi|hello|hey)\b/.test(normalized)) {
    return "Hello! How can I help today?";
  }
  if (normalized.includes("thank")) {
    return "You're welcome! Let me know if you need anything else.";
  }
  if (normalized.includes("how are you")) {
    return "I'm doing well and ready to help. How can I assist?";
  }
  if (normalized.includes("time")) {
    return `It's ${new Date().toLocaleTimeString()}.`;
  }
  if (normalized.includes("date")) {
    return `Today is ${new Date().toLocaleDateString()}.`;
  }
  if (normalized.includes("who are you")) {
    return "I'm cd/ai, here to help route your requests and share governed outputs.";
  }
  return "Got it. Let me know whenever you'd like to dive into something more detailed.";
}

function applyRuntimeModeToState(state, { forceGlobal = false } = {}) {
  if (!state) return getModeCapabilities();
  if (forceGlobal) {
    state.dataScopeOverride = false;
  }
  const targetMode =
    state.dataScopeOverride && state.dataScopeMode
      ? state.dataScopeMode
      : runtimeConfig.mode;
  const capabilities = getModeCapabilities(targetMode);
  state.dataScopeMode = capabilities.mode;
  state.allowedSources = capabilities.allowedSources;
  state.allowWeb = capabilities.allowWeb;
  state.provenanceMode = capabilities.provenanceMode;
  return capabilities;
}

function emitRuntimeModeStatus(target) {
  const capabilities = getModeCapabilities();
  const payload = {
    mode: runtimeConfig.mode,
    allowedSources: capabilities.allowedSources,
    allowWeb: capabilities.allowWeb,
    provenanceMode: capabilities.provenanceMode,
    timestamp: Date.now(),
  };
  const recipient = target || io;
  recipient.emit("runtime-mode-status", payload);
  recipient.emit("data-scope-mode-updated", { mode: payload.mode, timestamp: payload.timestamp });
}

function syncAllSessionsToRuntimeMode() {
  socketStates.forEach((sessionState) => applyRuntimeModeToState(sessionState, { forceGlobal: true }));
}

function normalizeRulesPayload(rawRules = []) {
  return (rawRules || []).map((r, idx) => {
    const text = typeof r === "string" ? r : r.text || r.description || "";
    const condition = typeof r === "string" ? r : r.condition || text || "";
    return {
      id: r.id || r.ruleId || `rule-${idx + 1}`,
      description: r.description || text,
      condition,
      severity:
        typeof r.severity === "number"
          ? r.severity
          : typeof r.severity === "string"
          ? r.severity
          : 1,
    };
  });
}

function emitParsedRules(ioInstance, rules = [], roomId = null) {
  if (!ioInstance) return;
  const payload = { rules: normalizeRulesPayload(rules), sessionId: roomId || undefined }; // EVENT MODEL FIX
  if (roomId && ioInstance.to) {
    ioInstance.to(roomId).emit("parsed-rules", payload);
    ioInstance.to(roomId).emit("governance-rules", payload);
  } else {
    ioInstance.emit("parsed-rules", payload);
    ioInstance.emit("governance-rules", payload);
  }
}

function normalizeGovernanceMode(mode) {
  const value = (mode || "").toString().toLowerCase();
  if (value === GOVERNANCE_MODES.SIMULATION) return GOVERNANCE_MODES.SIMULATION;
  if (value === GOVERNANCE_MODES.PHI_COMPLIANT) return GOVERNANCE_MODES.PHI_COMPLIANT;
  return GOVERNANCE_MODES.STRICT;
}

async function runUngovernedResponse(socket, message, { sessionId = null, replyText = "", metadata = {} } = {}) {
  const trimmed = typeof message === "string" ? message.trim() : "";
  const suppressResponse = !replyText;
  const payload = {
    text: replyText || "",
    suppressResponse,
    metadata: {
      suppressed: suppressResponse,
      originalInput: trimmed,
      ...metadata,
    },
  };
  if (sessionId && socket.server?.to) {
    socket.server.to(sessionId).emit("ungoverned-output", payload);
    socket.server.to(sessionId).emit("workflow-finished", { suppressResponse, sessionId });
  } else {
    socket.emit("ungoverned-output", payload);
    socket.emit("workflow-finished", { suppressResponse });
  }
}

function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.status(401).json({ error: "auth_required" });
}

ensureAdminUser();

app.get("/health", (_req, res) => {
  res.json({ ok: true, timestamp: Date.now() });
});

app.get("/api/auth/status", (req, res) => {
  if (req.session?.user) {
    return res.json({ authenticated: true, user: req.session.user });
  }
  return res.status(401).json({ authenticated: false });
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "invalid_credentials" });
  }
  try {
    const user = await verifyUserCredentials(username, password);
    if (!user) {
      return res.status(401).json({ error: "invalid_credentials" });
    }
    return req.session.regenerate((err) => {
      if (err) {
        console.error("[auth] session regenerate failed:", err);
        return res.status(500).json({ error: "auth_unavailable" });
      }
      req.session.user = getUserProfile(user);
      return res.json({ ok: true, user: req.session.user });
    });
  } catch (error) {
    console.error("[auth] login failed:", error);
    return res.status(500).json({ error: "auth_unavailable" });
  }
});

app.post("/api/logout", requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie(SESSION_COOKIE);
    res.json({ ok: true });
  });
});

app.post("/api/clear-rules", requireAuth, (_req, res) => {
  socketStates.forEach((state) => {
    if (state && Array.isArray(state.governanceRules)) {
      state.governanceRules = [];
    }
  });
  emitParsedRules(io, [], null);
  res.status(200).json({ ok: true });
});

if (process.env.DEBUG_EVENTS === "true") {
  debugRoute(app);
}

io.on("connection", (socket) => {
  const state = {
    id: socket.id,
    governanceRules: [],
    _driftState: null,
    _taskHistory: [],
    dataScopeMode: DEFAULT_DATA_SCOPE_MODE,
    dataScopeOverride: false,
    pendingClarification: false,
    governanceMode: GOVERNANCE_MODES.STRICT,
  };
  applyRuntimeModeToState(state);

  socketStates.set(socket.id, state);
  emitParsedRules(io, state.governanceRules, socket.id);
  socket.emit("data-scope-mode-initial", { mode: state.dataScopeMode }); // V1.2-PHASE4
  socket.emit("governance-mode-initial", { mode: state.governanceMode });
  emitRuntimeModeStatus(socket);

  // EVENT MODEL FIX: allow frontend to join session room explicitly
  socket.on("join-session", ({ sessionId }) => {
    if (sessionId) {
      socket.join(sessionId);
    }
  });

  socket.on("disconnect", () => {
    socketStates.delete(socket.id);
  });

  socket.on("clear-rules", () => {
    state.governanceRules = [];
    emitParsedRules(io, [], socket.id);
  });

  socket.on("reset-conversation", () => {
    state._driftState = null;
    state._taskHistory = [];
    io.to(socket.id).emit("telemetry", { type: "telemetry", subtype: "reset", sessionId: socket.id, data: {} }); // EVENT MODEL FIX
  });

  socket.on("set-data-scope-mode", (mode) => {
    handleDataScopeModeChange(state, socket, mode); // V1.2-PHASE5-FIX: shared handler ensures consistent behavior + testability
  });
  socket.on("governance:set-mode", ({ mode } = {}) => {
    setRuntimeMode(mode);
    syncAllSessionsToRuntimeMode();
    emitRuntimeModeStatus();
  });
  socket.on("set-governance-mode", (mode) => {
    const nextMode = normalizeGovernanceMode(mode);
    if (state.governanceMode === nextMode) {
      socket.emit("governance-mode-updated", { mode: state.governanceMode });
      return;
    }
    state.governanceMode = nextMode;
    socket.emit("governance-mode-updated", { mode: state.governanceMode });
  });
  socket.on("panel-invocation-request", (payload = {}) => {
    const requestId = payload?.requestId || `panel-${Date.now()}`;
    const response = {
      allowed: true,
      panelKey: payload?.panelKey || null,
      context: payload?.context || null,
      timestamp: Date.now(),
      message: "Panel invocation acknowledged (placeholder).",
      requestId,
    };
    socket.emit("panel-invocation-response", response);
  });

  socket.on("run-workflow", async (payload = {}) => {
    const capabilities = applyRuntimeModeToState(state);
    const {
      input = "",
      goal = "",
      maxCycles = null,
      governanceStrictness: clientStrictness = 0.85,
      perfMode = "real",
      rules = undefined,
      requiresGovernedOutput = false,
      sessionId = null,
      runId = null,
    } = payload;

    if (sessionId) {
      socket.join(sessionId);
    }

    const roomTarget = sessionId || socket.id;
    const trimmedInput = typeof input === "string" ? input.trim() : "";

    if (isSimpleConversationalMessage(trimmedInput)) {
      const replyText = buildSimpleConversationalReply(trimmedInput);
      await runUngovernedResponse(socket, trimmedInput, { sessionId: roomTarget, replyText });
      return;
    }

    const inboundRules =
      rules === undefined
        ? state.governanceRules
        : Array.isArray(rules) && rules.length > 0
        ? rules
        : state.governanceRules;

    if (Array.isArray(rules) && rules.length > 0) {
      state.governanceRules = rules;
    }

    const requestSignals = deriveRequestSignals(input || "");
    const strictnessLabel = computeDynamicStrictness({
      intent: requestSignals.intent,
      domain: requestSignals.domain,
      sensitivity: requestSignals.sensitivity,
      dataSources: capabilities.allowedSources,
    });
    const computedStrictness = strictnessLabelToValue(strictnessLabel);
    const normalizedClientStrictness =
      typeof clientStrictness === "number" && Number.isFinite(clientStrictness) ? clientStrictness : 0.85;
    const effectiveGovernanceStrictness = Math.max(computedStrictness, normalizedClientStrictness);

    try {
      const envelope = parseGovernanceEnvelope(input || "");
      const intent = await classifyGovernanceIntent(input || "");
      const classification = classifyGovernanceRequest(input || "", { entrypoint: "server.run-workflow" });
      const rawRequestType = classification.requestType || REQUEST_TYPES.UNKNOWN;
      const requestType = rawRequestType === REQUEST_TYPES.UNKNOWN ? REQUEST_TYPES.GOVERNED : rawRequestType;
      const strictnessFromClassifier =
        classification.requiredStrictness && typeof classification.requiredStrictness.level === "number"
          ? classification.requiredStrictness
          : null;
      const computedStrictnessMeta = computeStrictness(input || "", inboundRules, { requestType });
      const strictnessMeta =
        strictnessFromClassifier && strictnessFromClassifier.level > (computedStrictnessMeta?.level ?? 0)
          ? strictnessFromClassifier
          : computedStrictnessMeta;
      classification.requiredStrictness = strictnessMeta;

      envelope.classification = classification;
      if (classification.simulationFlag) {
        envelope.simulationDetected = true;
      }
      const isSimulationDecision =
        classification && classification.governanceDecision === "simulation";

      io.to(roomTarget).emit("telemetry", {
        type: "governance",
        subtype: "classification",
        sessionId: roomTarget,
        data: classification,
      });

      if (intent && intent.label === "rule_addition") {
        const ruleText =
          (intent.ruleCandidates && intent.ruleCandidates[0]) ||
          input.replace(/add rule:?/i, "").trim();
        if (ruleText) {
          state.governanceRules.push({
            text: ruleText,
            origin: "user",
            status: "pending",
          });
          emitParsedRules(io, state.governanceRules, roomTarget);
        }
        return;
      }

      const parsedPayload = { rules: normalizeRulesPayload(inboundRules), sessionId: roomTarget };
      io.to(roomTarget).emit("parsed-rules", parsedPayload);
      io.to(roomTarget).emit("governance-rules", parsedPayload);

      if (!isSimulationDecision && requestType !== REQUEST_TYPES.GOVERNED) {
        await runUngovernedResponse(socket, input || "", { sessionId: roomTarget });
        return;
      }

      runGovernedWorkflow._inFlight = false;
      const result = await runGovernedWorkflow(socket, {
        input,
        goal,
        maxCycles,
        governanceStrictness: effectiveGovernanceStrictness,
        perfMode,
        rules: inboundRules,
        governanceEnvelope: envelope,
        classification,
        requiresGovernedOutput,
        sessionId: roomTarget,
        runId: runId || roomTarget,
        dataScopeMode: state.dataScopeMode || DEFAULT_DATA_SCOPE_MODE,
        governanceMode: state.governanceMode || GOVERNANCE_MODES.STRICT,
        allowedSources: capabilities.allowedSources,
        allowWeb: capabilities.allowWeb,
        provenanceMode: capabilities.provenanceMode,
      });

      if (result?.paused && result.context) {
        pendingClarifications.set(roomTarget, result.context);
        state.pendingClarification = true;
      }
    } catch (err) {
      console.error("Workflow error:", err);
      io.to(roomTarget).emit("governance-errors", { error: String(err?.message || err) });
      // EVENT MODEL FIX: emit telemetry in standard shape and scoped to session
      io.to(roomTarget).emit("telemetry", {
        type: "telemetry",
        subtype: "error",
        sessionId: roomTarget,
        data: { message: String(err && err.message ? err.message : err) },
      });
    }
  });

  socket.on("clarification-response", async (payload = {}) => {
    const { sessionId = null, runId = null, clarificationAnswer = "" } = payload;
    const roomTarget = sessionId || socket.id;
    const checkpoint = pendingClarifications.get(roomTarget);
    if (!checkpoint) return;
    // V1-PHASE1C: restore MCP checkpoint
    const restoredState = restoreCycleState(checkpoint);
    pendingClarifications.delete(roomTarget);
    state.pendingClarification = false;
    io.to(roomTarget).emit("clarification-accepted", { sessionId: roomTarget, runId: runId || roomTarget });
    await resumeFromClarification(socket, restoredState, clarificationAnswer);
  });
});

if (process.env.DEBUG_EVENTS === "true") {
  attachHarness(io);
}

console.log("[cd/ai] Volume 1 governance status:", VOLUME_1_STATUS);
console.log("[cd/ai] Volume 1.1 status:", VOLUME_1_1_STATUS);

function getSessionMode(sessionId) {
  const session = socketStates.get(sessionId);
  if (!session) return DEFAULT_DATA_SCOPE_MODE;
  if (!session.dataScopeMode) {
    session.dataScopeMode = DEFAULT_DATA_SCOPE_MODE;
  }
  return session.dataScopeMode;
}

const PORT = process.env.PORT || 5006;
server.listen(PORT, () => {
  console.log(`[cd/ai] Server running on port ${PORT}`);
});

module.exports = server;
module.exports.getSessionMode = getSessionMode;
