require("dotenv").config();

const path = require("path");
const express = require("express");
const http = require("http");
const cookieParser = require("cookie-parser");
const { Server } = require("socket.io");

// Import the rebuilt enterprise-grade workflow engine
const {
  runGovernedWorkflow,
  parseRulesFromGoal,
  parseGovernanceEnvelope,
} = require("./workflow/runGovernedWorkflow");
const {
  classifyGovernanceIntent,
  generateGovernanceNarrative,
  computeConfidenceScore,
} = require("./workflow/openaiClient");

// -----------------------------------------------------------------------------
// Port Configuration
// -----------------------------------------------------------------------------

const PORT = process.env.PORT ? Number(process.env.PORT) : 5005;

if (!PORT || Number.isNaN(PORT)) {
  console.error("ERROR: Invalid port configuration.");
  process.exit(1);
}

// -----------------------------------------------------------------------------
// Environment & Secrets
// -----------------------------------------------------------------------------

const APP_PASSWORD = process.env.APP_PASSWORD;
if (!APP_PASSWORD) {
  console.warn("WARNING: APP_PASSWORD is not set. Authentication will fail.");
}

const COOKIE_SECRET = process.env.COOKIE_SECRET || "dev-secret";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.warn(
    "WARNING: OPENAI_API_KEY is not set. The workflow will fail until you set it in .env or Render env vars."
  );
}

// -----------------------------------------------------------------------------
// Express + Socket.IO Setup
// -----------------------------------------------------------------------------

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const socketStateStore = new Map();

// Parse bodies (for /auth)
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser(COOKIE_SECRET));

// Basic header
app.use((req, res, next) => {
  res.setHeader("X-Powered-By", "cd/ai mvp");
  next();
});

// Enable embedding in iframes (e.g., from WordPress)
app.use((req, res, next) => {
  res.removeHeader("X-Frame-Options");
  res.setHeader("Content-Security-Policy", "frame-ancestors *");
  next();
});

function isAuthenticated(req) {
  return req.signedCookies?.session === "authenticated";
}

// -----------------------------------------------------------------------------
// Static Files
// -----------------------------------------------------------------------------

const PUBLIC_DIR = path.join(__dirname, "public");

app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// Authentication gate
app.use((req, res, next) => {
  const openPaths = ["/login", "/auth", "/styles.css", "/login.css", "/health"];
  const isOpen =
    openPaths.includes(req.path) ||
    req.path.startsWith("/assets/") ||
    req.path.startsWith("/socket.io/");

  if (isOpen) return next();
  if (isAuthenticated(req)) return next();
  return res.redirect("/login");
});

app.use("/assets", express.static(path.join(PUBLIC_DIR, "assets")));

// Login page route
app.get("/login", (req, res) => {
  if (isAuthenticated(req)) {
    return res.redirect("/");
  }
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// Main app route (protected)
app.get("/", (req, res) => {
  if (!isAuthenticated(req)) {
    return res.redirect("/login");
  }
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use(express.static(PUBLIC_DIR));

// -----------------------------------------------------------------------------
// Auth Routes
// -----------------------------------------------------------------------------

app.post("/auth", (req, res) => {
  const password = (req.body && req.body.password) || "";
  if (password && APP_PASSWORD && password === APP_PASSWORD) {
    res.cookie("session", "authenticated", {
      httpOnly: true,
      signed: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    return res.redirect("/");
  }

  return res.redirect("/login?error=1");
});

app.post("/auth/logout", (req, res) => {
  res.clearCookie("session");
  res.json({ ok: true });
});

// Clear governance rules (global reset for current session sockets)
app.post("/clear-rules", (req, res) => {
  let resetCount = 0;
  socketStateStore.forEach((state, socketId) => {
    state.governanceRules = [];
    state.governanceEnvelope = null;
    state.pendingDrift = null;
    state.rulesFrozen = false;
    state.rulesFinalized = false;
    state.strictnessOverride = null;
    state.maxCyclesOverride = null;
    state.confidenceScore = null;
    const ledgerEntry = {
      timestamp: new Date().toISOString(),
      event: "rule_reset",
      stage: "Governance",
      cycle: 0,
      summary: "Governance rules cleared via /clear-rules endpoint.",
    };
    state.governanceLedger = [ledgerEntry];
    const socketInstance = io.sockets.sockets.get(socketId);
    if (socketInstance) {
      emitRules(socketInstance, state);
      socketInstance.emit("telemetry", {
        type: "governance-response",
        text: "All governance rules have been cleared.",
      });
      socketInstance.emit("telemetry", {
        type: "ledger",
        entries: state.governanceLedger,
      });
    }
    resetCount += 1;
  });

  res.json({ success: true, resetCount });
});

// Health endpoint for Render
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// -----------------------------------------------------------------------------
// Socket.IO Governed Workflow
// -----------------------------------------------------------------------------

io.use((socket, next) => {
  const cookieHeader = socket.request.headers.cookie || "";
  const cookies = parseCookies(cookieHeader);
  const sessionCookie = cookieParser.signedCookie(
    cookies.session,
    COOKIE_SECRET
  );
  if (sessionCookie === "authenticated") {
    return next();
  }
  return next(new Error("unauthorized"));
});

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Per-socket state (can be extended later for meta-governance)
  const socketState = {
    governanceGoal: null,
    governanceRules: [],
    rulesFinalized: false,
    governanceLedger: [],
    pendingDrift: null, // { task, goal, maxCycles, governanceStrictness, perfMode, suggestion }
    governanceEnvelope: null,
    rulesFrozen: false,
    strictnessOverride: null,
    maxCyclesOverride: null,
    confidenceScore: null,
    pendingInferredRule: null,
    awaitingInferredRuleConfirmation: false,
  };
  socketStateStore.set(socket.id, socketState);

  socket.on("reset-conversation", () => {
    socket.emit("telemetry", { type: "reset" });
  });

  socket.on("governance-command", (payload) => {
    handleGovernanceCommand(socket, socketState, payload);
  });

  // ---------------------------------------------------------------------------
  // chat-message (legacy / optional entrypoint)
  // ---------------------------------------------------------------------------
  socket.on(
    "chat-message",
    async ({ text, maxCycles, governanceStrictness, perfMode }) => {
      const input = typeof text === "string" ? text.trim() : "";
      if (!input) return;

      if (socket._pendingClarification) {
        const lower = input.toLowerCase().trim();
        const isYes = /^y(es)?|ok|sure|include/.test(lower);
        const isNo = /^n(o)?/.test(lower);
        const isClarify = lower.startsWith("clarify");
        socket.emit("clarification-response", {
          cycle: socket._pendingClarification.cycle,
          answer: isClarify ? input : isYes ? "yes" : isNo ? "no" : input,
        });
        socket._pendingClarification = null;
        return;
      }

      const goal =
        typeof socketState.governanceGoal === "string"
          ? socketState.governanceGoal
          : "";

      // Per-task reset: clear any persisted rules before starting a new task.
      socketState.governanceRules = [];
      socketState.activeRules = [];
      socketState.pendingDrift = null;
      socketState.governanceEnvelope = null;
      socketState.rulesFrozen = false;
      socketState.rulesFinalized = false;
      socketState.strictnessOverride = null;
      socketState.maxCyclesOverride = null;
      socketState.confidenceScore = null;
      socket._pendingClarification = null;
      socket._pendingClarification = null;

      console.log("Chat-based workflow:", {
        input,
        goalPreview: goal.slice(0, 80),
        maxCycles,
        governanceStrictness,
        perfMode,
      });

      try {
        const cmd = detectGovernanceCommand(input);
        if (cmd.isCommand) {
          const handled = executeGovernanceCommand(cmd, socketState, socket);
          if (handled) return;
        }

        let envelope;
        envelope = parseGovernanceEnvelope(input); // always parse fresh
        socketState.governanceEnvelope = envelope;

        const requiresGovernedOutput = envelope?.requiresGovernedOutput === true;

        await runGovernedWorkflow(socket, {
          input,
          goal,
          maxCycles,               // ★ FIXED — GIL-Lite enabled
          governanceStrictness,
          perfMode,
          rules: socketState.governanceRules,
          governanceEnvelope: envelope,
        });
      } catch (err) {
        console.error("Workflow error (chat-message):", err);

        socket.emit("telemetry", {
          type: "mcp-status",
          status: "Error",
          detail:
            "An error occurred while running the governed workflow. Please try again.",
        });

        socket.emit("telemetry", {
          type: "final-output",
          text: "An error occurred while running the governed workflow. Please try again.",
        });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // run-workflow (primary entrypoint used by current app.js)
  // ---------------------------------------------------------------------------
  socket.on(
    "run-workflow",
    async ({ input, goal, maxCycles, governanceStrictness, perfMode }) => {
      let text = typeof input === "string" ? input.trim() : "";
      if (!text) return;

      // If a pending inferred rule confirmation is awaiting, treat this message as the answer.
      if (socket._pendingClarification) {
        const answer = text.toLowerCase();
        const lower = answer.trim();
        const isYes = /^y(es)?|ok|sure|include/.test(lower);
        const isNo = /^n(o)?/.test(lower);
        const isClarify = lower.startsWith("clarify");
        socket.emit("clarification-response", {
          cycle: socket._pendingClarification.cycle,
          answer: isClarify ? text : isYes ? "yes" : isNo ? "no" : text,
        });
        socket._pendingClarification = null;
        return;
      }

      // Per-task reset: clear any persisted rules before starting a new task.
      socketState.governanceRules = [];
      socketState.activeRules = [];
      socketState.pendingDrift = null;
      socketState.governanceEnvelope = null;
      socketState.rulesFrozen = false;
      socketState.rulesFinalized = false;
      socketState.strictnessOverride = null;
      socketState.maxCyclesOverride = null;
      socketState.confidenceScore = null;

      console.log("Starting workflow:", {
        input: text,
        goal,
        maxCycles,
        governanceStrictness,
        perfMode,
      });

      try {
        const cmd = detectGovernanceCommand(text);
        if (cmd.isCommand) {
          const handled = executeGovernanceCommand(cmd, socketState, socket);
          if (handled) return;
        }

        // Handle pending drift confirmation
        if (socketState.pendingDrift) {
          const lower = text.toLowerCase();
          const confirmClear = lower.includes("yes") || lower.includes("clear");
          const declineClear = lower.startsWith("no");
          if (confirmClear) {
            socketState.governanceRules = [];
            socketState.governanceLedger.push({
              timestamp: new Date().toISOString(),
              event: "rule-clear",
              stage: "Governance",
              cycle: 0,
              raw: text,
              reason: "drift-confirmation",
            });
            emitRules(socket, socketState);
            socket.emit("telemetry", {
              type: "governance-response",
              text: "Rules cleared after drift confirmation.",
            });
            // proceed with stored task after clearing
            text = socketState.pendingDrift.task || text;
          } else if (declineClear) {
            socketState.governanceLedger.push({
              timestamp: new Date().toISOString(),
              event: "drift-decline",
              stage: "Governance",
              cycle: 0,
              raw: text,
              summary: "User declined to clear rules after drift prompt.",
            });
            socket.emit("telemetry", {
              type: "governance-response",
              text: "User declined to clear rules after drift warning; keeping existing rules.",
            });
            text = socketState.pendingDrift.task || text;
          } else {
            socket.emit("telemetry", {
              type: "governance-response",
              text:
                "Please confirm: say 'yes, clear the rules' to clear or 'no' to keep them.",
            });
            return;
          }
          socketState.pendingDrift = null;
        }

        if (!socketState.governanceRules || socketState.governanceRules.length === 0) {
          socketState.pendingDrift = null;
        }

        let envelope;
        envelope = parseGovernanceEnvelope(text); // always parse fresh
        socketState.governanceEnvelope = envelope;

        // Initialize PCGP governance envelope for this submission

        const intent = await classifyGovernanceIntent(text);
        socketState.governanceLedger.push({
          timestamp: new Date().toISOString(),
          event: "intent-classification",
          raw: text,
          stage: "Governance",
          cycle: 0,
          intent,
          summary: `Intent classified as ${intent.label} (confidence ${Number(
            intent.confidence || 0
          ).toFixed(2)})`,
        });
        socketState.confidenceScore = computeConfidenceScore({
          structured: intent.label === "task" && intent.confidence >= 0.9,
          messy:
            intent.label === "mixed" ||
            intent.label === "ambiguous" ||
            (intent.label === "task" && intent.confidence >= 0.5 && intent.confidence < 0.9),
          commandOnly: intent.label === "rule_clear" || intent.label === "rule_query",
        });
        // Update confidence score heuristic
        socketState.confidenceScore = computeConfidenceScore({
          structured: intent.label === "task" && intent.confidence >= 0.9,
          messy:
            intent.label === "mixed" ||
            intent.label === "ambiguous" ||
            (intent.label === "task" && intent.confidence >= 0.5 && intent.confidence < 0.9),
          commandOnly: intent.label === "rule_clear" || intent.label === "rule_query",
        });

        // Guard against spurious rule labels when no candidates were extracted
        const isRuleish =
          intent.label &&
          (intent.label.startsWith("rule_") || intent.label === "mixed");
        if (
          isRuleish &&
          (!intent.ruleCandidates || intent.ruleCandidates.length === 0) &&
          Number(intent.confidence || 0) < 0.75
        ) {
          socket.emit("telemetry", {
            type: "governance-response",
            text:
              "Your message may include governance constraints and a task. Should I capture any rules from it, or treat it purely as a task?",
          });
          socketState.governanceLedger.push({
            timestamp: new Date().toISOString(),
            event: "intent-ambiguous-ruleish",
            stage: "Governance",
            cycle: 0,
            summary:
              "Rule-like intent with low confidence and no extracted rules; asked user to clarify.",
          });
          return;
        }

        const applyRuleCandidates = (cands) => {
          (cands || []).forEach((ruleText) => {
            const t = (ruleText || "").trim();
            if (!t) return;
            socketState.governanceRules.push({
              text: t,
              origin: "user",
              status: "pending",
            });
            socketState.governanceLedger.push({
              timestamp: new Date().toISOString(),
              event: "rule-add",
              stage: "Governance",
              cycle: 0,
              rule: t,
              summary: `Added rule: ${t}`,
            });
          });
          emitRules(socket, socketState);
        };

        const narrate = async (summary) => {
          // Avoid OpenAI narrative here; send a concise governance-response instead
          socket.emit("telemetry", {
            type: "governance-response",
            text: summary,
          });
          socketState.governanceLedger.push({
            timestamp: new Date().toISOString(),
            event: "narrative",
            stage: "Governance",
            cycle: 0,
            summary,
            narrative: summary,
          });
        };

        if (
          intent.label === "rule_addition" ||
          intent.label === "rule_modify" ||
          intent.label === "rule_removal" ||
          intent.label === "rule_clear" ||
          intent.label === "rule_query"
        ) {
          if (intent.label === "rule_addition") {
            applyRuleCandidates(intent.ruleCandidates?.length ? intent.ruleCandidates : [text]);
            await narrate("Added governance rule(s).");
            return;
          }
          if (intent.label === "rule_modify") {
            let idx = Number(intent?.rulesToModify?.[0] ?? -1);
            if (!Number.isInteger(idx) || idx < 0) {
              const match = text.match(/rule\s+(\d+)/i);
              if (match) idx = Number(match[1]) - 1;
            }
            if (Number.isInteger(idx) && idx >= 0 && idx < socketState.governanceRules.length) {
              const newText =
                (intent.ruleCandidates && intent.ruleCandidates[0]) || text;
              socketState.governanceRules[idx] = {
                ...socketState.governanceRules[idx],
                text: newText,
                origin: "user",
                status: "pending",
              };
              socketState.governanceLedger.push({
                timestamp: new Date().toISOString(),
                event: "rule-modify",
                stage: "Governance",
                cycle: 0,
                index: idx,
                text: newText,
                summary: `Modified rule ${idx + 1}: ${newText}`,
              });
              emitRules(socket, socketState);
              await narrate("Modified governance rule.");
              return;
            }
            socket.emit("telemetry", {
              type: "governance-response",
              text:
                "I couldn't identify which rule to modify. Please say “replace rule N with …”.",
            });
            return;
          }
          if (intent.label === "rule_removal") {
            let idx = Number(intent?.ruleIndex ?? -1);
            if (!Number.isInteger(idx) || idx < 0) {
              const match = text.match(/rule\s+(\d+)/i);
              if (match) idx = Number(match[1]) - 1;
            }
            if (Number.isInteger(idx) && idx >= 0 && idx < socketState.governanceRules.length) {
              socketState.governanceRules.splice(idx, 1);
              socketState.governanceLedger.push({
                timestamp: new Date().toISOString(),
                event: "rule-remove",
                stage: "Governance",
                cycle: 0,
                index: idx,
                summary: `Removed rule ${idx + 1}`,
              });
              emitRules(socket, socketState);
              await narrate("Removed governance rule.");
              return;
            }
            socket.emit("telemetry", {
              type: "governance-response",
              text: "Please specify a valid rule number to remove.",
            });
            return;
          }
          if (intent.label === "rule_clear") {
            socket.emit("telemetry", {
              type: "governance-response",
              text:
                "This will clear all rules. Please confirm: say “yes, clear rules” to proceed.",
            });
            socketState.governanceLedger.push({
              timestamp: new Date().toISOString(),
              event: "rule-clear-prompt",
              stage: "Governance",
              cycle: 0,
              raw: text,
              summary: "Prompted user to confirm clearing all rules.",
            });
            return;
          }
          if (intent.label === "rule_query") {
            if (!socketState.governanceRules.length) {
              socket.emit("telemetry", {
                type: "governance-response",
                text: "You currently have no governance rules.",
              });
            } else {
              const listText = socketState.governanceRules
                .map((r, i) => `${i + 1}. ${r.text}`)
                .join("\n");
              socket.emit("telemetry", {
                type: "governance-response",
                text: `Current rules:\n${listText}`,
              });
            }
            return;
          }
        }

        if (intent.label === "mixed") {
          applyRuleCandidates(intent.ruleCandidates?.length ? intent.ruleCandidates : []);
          if (intent.task) {
            text = intent.task;
            socketState.governanceLedger.push({
              timestamp: new Date().toISOString(),
              event: "mixed-resolution",
              stage: "Governance",
              cycle: 0,
              rulesApplied: intent.ruleCandidates || [],
              task: text,
              summary: "Processed mixed message: applied rules and captured task.",
            });
            await narrate("Processed mixed message: applied rules and will run task.");
          } else {
            socket.emit("telemetry", {
              type: "governance-response",
              text:
                "Your message contains both governance instructions and a task. Should I treat part as a rule and part as a task?",
            });
            return;
          }
        }

        if (intent.label === "ambiguous") {
          socket.emit("telemetry", {
            type: "governance-response",
            text:
              "Would you like me to treat this as a governance update or a task request?",
          });
          await narrate("Ambiguous intent detected; requested clarification.");
          return;
        }

        // Task or mixed with task: proceed to workflow
        const requiresGovernedOutput =
          socketState.governanceEnvelope?.requiresGovernedOutput === true;

        await runGovernedWorkflow(socket, {
          input: text,
          goal,
          maxCycles: socketState.maxCyclesOverride || maxCycles,               // ★ FIXED — GIL-Lite enabled
          governanceStrictness:
            socketState.strictnessOverride !== null
              ? socketState.strictnessOverride
              : governanceStrictness,
          perfMode,
          rules: socketState.governanceRules,
          baseLedger: socketState.governanceLedger,
          governanceEnvelope: socketState.governanceEnvelope,
          confidenceScore: socketState.confidenceScore,
          requiresGovernedOutput,
        });
        socketState.governanceLedger = [];
      } catch (err) {
        console.error("Workflow error:", err);

        socket.emit("telemetry", {
          type: "mcp-status",
          status: "Error",
          detail:
            "An error occurred while running the governed workflow. Please try again.",
        });

        socket.emit("telemetry", {
          type: "final-output",
          text: "An error occurred while running the governed workflow. Please try again.",
        });
      }
    }
  );

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    socketStateStore.delete(socket.id);
  });
});

// -----------------------------------------------------------------------------
// Helper Functions (only for knob normalization in this file)
// -----------------------------------------------------------------------------

function normalizeMaxCycles(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 5;
  return Math.min(10, Math.max(1, Math.round(n)));
}

function normalizeStrictness(raw) {
  const f = Number(raw);
  if (!Number.isFinite(f)) return 0.85;
  return Math.min(1, Math.max(0, f));
}

function normalizePerfMode(raw) {
  const v = (raw || "").toString().toLowerCase();
  if (v === "fast" || v === "turbo") return v;
  return "real";
}

function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  return cookieHeader.split(";").reduce((acc, pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return acc;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    try {
      acc[key] = decodeURIComponent(val);
    } catch {
      acc[key] = val;
    }
    return acc;
  }, {});
}

// ----------------------------------------------------------------------------- 
// Governance Command Layer (GCL) --------------------------------------------- 
// ----------------------------------------------------------------------------- 

function detectGovernanceCommand(rawInputText) {
  const text = (rawInputText || "").trim().toLowerCase();
  const result = { isCommand: false, commandType: null, commandArgs: {} };
  if (!text) return result;

  const matchNumber = text.match(/(\d+)/);
  const explicitPhrases = [
    { type: "clear-rules", pattern: /\b(clear|reset)\s+rules\b/ },
    { type: "clear-rules", pattern: /\b(clear|reset)\s+governance\b/ },
    { type: "show-rules", pattern: /\b(show|list)\s+rules\b/ },
    { type: "strictness-off", pattern: /\bstrictness\s+off\b/ },
    { type: "strictness-on", pattern: /\bstrictness\s+on\b/ },
    { type: "set-max-cycles", pattern: /\bset\s+max\s+cycles\b|\bmax\s+cycles\b/ },
    { type: "freeze-rules", pattern: /\b(freeze|lock)\s+rules\b/ },
    { type: "unfreeze-rules", pattern: /\b(unfreeze|unlock)\s+rules\b/ },
  ];

  for (const { type, pattern } of explicitPhrases) {
    if (pattern.test(text)) {
      return { isCommand: true, commandType: type, commandArgs: {} };
    }
  }

  return result;
}

function executeGovernanceCommand(cmd, session, socket) {
  if (!cmd?.isCommand) return false;
  const sendAck = (text) =>
    socket.emit("telemetry", {
      type: "governance-response",
      text,
    });

  switch (cmd.commandType) {
    case "clear-rules": {
      session.governanceRules = [];
      session.governanceEnvelope = null;
      session.pendingDrift = null;
      session.rulesFrozen = false;
      session.governanceLedger.push({
        timestamp: new Date().toISOString(),
        event: "command-clear-rules",
        stage: "MCP - Command",
        cycle: 0,
        summary: "Governance rules cleared via command.",
      });
      emitRules(socket, session);
      sendAck("Governance rules cleared.");
      return true;
    }
    case "show-rules": {
      if (!session.governanceRules.length) {
        sendAck("No governance rules are currently set.");
      } else {
        const list = session.governanceRules.map((r, i) => `${i + 1}. ${r.text}`).join("\n");
        sendAck(`Current rules:\n${list}`);
      }
      return true;
    }
    case "strictness-off": {
      session.strictnessOverride = 0;
      sendAck("Strictness set to OFF for this session.");
      return true;
    }
    case "strictness-on": {
      session.strictnessOverride = 0.85;
      sendAck("Strictness set to ON (0.85) for this session.");
      return true;
    }
    case "set-max-cycles": {
      const v = Number(cmd.commandArgs?.value);
      if (!Number.isFinite(v) || v <= 0) {
        sendAck("Please provide a valid number of cycles.");
        return true;
      }
      session.maxCyclesOverride = v;
      sendAck(`Max cycles set to ${v} for this session.`);
      return true;
    }
    case "freeze-rules": {
      session.rulesFrozen = true;
      sendAck("Governance rules frozen. New submissions will not change the envelope.");
      return true;
    }
    case "unfreeze-rules": {
      session.rulesFrozen = false;
      sendAck("Governance rules unfrozen. New submissions will update the envelope.");
      return true;
    }
    default:
      return false;
  }
}

function emitRules(socket, socketState) {
  const rules = socketState.governanceRules || [];
  const summary = rules.reduce(
    (acc, r) => {
      if (r.status === "passed") acc.passed += 1;
      else if (r.status === "failed") acc.failed += 1;
      else if (r.status === "clarified") acc.clarified += 1;
      else acc.pending += 1;
      acc.total += 1;
      return acc;
    },
    { passed: 0, failed: 0, clarified: 0, pending: 0, total: 0 }
  );

  socket.emit("telemetry", {
    type: "governance-rules",
    rules,
    summary,
    rulesFinalized: socketState.rulesFinalized,
  });
}

function handleGovernanceCommand(socket, socketState, payload) {
  if (!payload || typeof payload !== "object") {
    socket.emit("telemetry", {
      type: "governance-response",
      text: "I couldn't understand that governance update. Please clarify whether to add, remove, replace, clear, or list rules.",
    });
    return;
  }

  const action = payload.action;
  switch (action) {
    case "add": {
      const text = (payload.text || "").trim();
      if (!text) {
        socket.emit("telemetry", {
          type: "governance-response",
          text: "Please provide the rule text to add.",
        });
        return;
      }
      socketState.governanceRules.push({
        text,
        origin: "user",
        status: "pending",
      });
      socket.emit("telemetry", {
        type: "governance-response",
        text:
          "Understood. I’ve added that rule. Would you like to add more, modify an existing one, or proceed with your task?",
      });
      emitRules(socket, socketState);
      return;
    }
    case "remove": {
      const idx = Number(payload.index);
      if (!Number.isInteger(idx) || idx < 0 || idx >= socketState.governanceRules.length) {
        socket.emit("telemetry", {
          type: "governance-response",
          text: "I couldn't find that rule number to remove. Please provide a valid rule index.",
        });
        return;
      }
      socketState.governanceRules.splice(idx, 1);
      socket.emit("telemetry", {
        type: "governance-response",
        text: `Rule ${idx + 1} has been removed. Here is the updated rule set.`,
      });
      emitRules(socket, socketState);
      return;
    }
    case "replace": {
      const idx = Number(payload.index);
      const text = (payload.text || "").trim();
      if (!Number.isInteger(idx) || idx < 0 || idx >= socketState.governanceRules.length || !text) {
        socket.emit("telemetry", {
          type: "governance-response",
          text: "To replace a rule, specify a valid rule number and the new text.",
        });
        return;
      }
      socketState.governanceRules[idx] = {
        ...socketState.governanceRules[idx],
        text,
        origin: "user",
        status: "pending",
      };
      socket.emit("telemetry", {
        type: "governance-response",
        text: `Rule ${idx + 1} has been updated.`,
      });
      emitRules(socket, socketState);
      return;
    }
    case "clear": {
      socketState.governanceRules = [];
      socket.emit("telemetry", {
        type: "governance-response",
        text: "All governance rules have been cleared.",
      });
      emitRules(socket, socketState);
      return;
    }
    case "list": {
      if (!socketState.governanceRules.length) {
        socket.emit("telemetry", {
          type: "governance-response",
          text: "No governance rules are currently set.",
        });
        return;
      }
      const listText = socketState.governanceRules
        .map((r, i) => `${i + 1}. ${r.text}`)
        .join("\n");
      socket.emit("telemetry", {
        type: "governance-response",
        text: `Here are the current rules:\n${listText}`,
      });
      return;
    }
    case "ask-final": {
      socket.emit("telemetry", {
        type: "governance-response",
        text:
          "If the rules are final, I will enforce them for the next task. Should I lock them in?",
      });
      return;
    }
    case "finalize-yes": {
      socketState.rulesFinalized = true;
      socket.emit("telemetry", {
        type: "governance-response",
        text: "Rules have been marked as finalized. You can still revise them if needed.",
      });
      emitRules(socket, socketState);
      return;
    }
    case "how-revise": {
      socket.emit("telemetry", {
        type: "governance-response",
        text:
          "You can say things like “add rule: …”, “remove rule 2”, “replace rule 4 with …”, or “clear all rules.”",
      });
      return;
    }
    case "mixed": {
      socket.emit("telemetry", {
        type: "governance-response",
        text:
          "Your message contains both governance instructions and a task. Should I update the rules, run the task, or do both?",
      });
      return;
    }
    default: {
      socket.emit("telemetry", {
        type: "governance-response",
        text:
          "Would you like me to treat this as a governance update or a task request?",
      });
      return;
    }
  }
}

// -----------------------------------------------------------------------------
// Start Server
// -----------------------------------------------------------------------------

server.listen(PORT, () => {
  console.log(`cd\\ai MVP server running on port ${PORT}`);
});
