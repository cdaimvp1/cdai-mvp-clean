require("dotenv").config();

const path = require("path");
const express = require("express");
const http = require("http");
const session = require("express-session");
const { Server } = require("socket.io");

// Import the rebuilt enterprise-grade workflow engine
const {
  runGovernedWorkflow,
  parseRulesFromGoal,
} = require("./workflow/runGovernedWorkflow");

// -----------------------------------------------------------------------------
// Port Configuration
// -----------------------------------------------------------------------------

const PORT = process.env.PORT ? Number(process.env.PORT) : 5003;

if (!PORT || Number.isNaN(PORT)) {
  console.error("ERROR: Invalid port configuration.");
  process.exit(1);
}

// -----------------------------------------------------------------------------
// Environment & Secrets
// -----------------------------------------------------------------------------

const DEMO_PASSWORD = process.env.SESSION_PASSWORD;
if (!DEMO_PASSWORD) {
  console.error("SESSION_PASSWORD missing from environment");
  process.exit(1);
}

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.error("SESSION_SECRET missing from environment");
  process.exit(1);
}

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

// Parse JSON bodies (for /auth/login)
app.use(express.json());

// Sessions
const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 60 * 60 * 1000, // 1 hour
  },
});

app.use(sessionMiddleware);

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

// Share session with Socket.IO if needed
io.engine.use(sessionMiddleware);

// -----------------------------------------------------------------------------
// Static Files
// -----------------------------------------------------------------------------

const PUBLIC_DIR = path.join(__dirname, "public");

app.use("/assets", express.static(path.join(PUBLIC_DIR, "assets")));
app.use(express.static(PUBLIC_DIR));
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// Login page route
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// -----------------------------------------------------------------------------
// Auth Routes (used by login overlay in index.html)
// -----------------------------------------------------------------------------

// Protect main app
app.get("/", (req, res, next) => {
  if (!req.session.authenticated) return res.redirect("/login");
  next();
});

app.post("/auth/login", (req, res) => {
  const { password } = req.body || {};
  if (password === "J@cks0n") {
    req.session.authenticated = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: "Invalid password" });
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Health endpoint for Render
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// -----------------------------------------------------------------------------
// Socket.IO Governed Workflow
// -----------------------------------------------------------------------------

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Per-socket state (can be extended later for meta-governance)
  const socketState = {
    governanceGoal: null,
  };

  // Optional explicit governance submission
  socket.on("submit-governance", ({ goal }) => {
    const normalized = typeof goal === "string" ? goal.trim() : "";
    socketState.governanceGoal = normalized || null;

    // Use the shared parseRulesFromGoal from the workflow module
    const baseRules = parseRulesFromGoal(normalized || "");

    // Shape into rule objects for the UI (matches runGovernedWorkflow behavior)
    const rules = baseRules.map((t) => ({
      text: t,
      origin: "user",
      status: "pending",
    }));

    socket.emit("telemetry", {
      type: "governance-rules",
      rules,
    });
  });

  socket.on("reset-governance", () => {
    socketState.governanceGoal = null;
    socket.emit("telemetry", {
      type: "governance-rules",
      rules: [],
    });
  });

  socket.on("reset-conversation", () => {
    socket.emit("telemetry", { type: "reset" });
  });

  // ---------------------------------------------------------------------------
  // chat-message (legacy / optional entrypoint)
  // ---------------------------------------------------------------------------
  socket.on(
    "chat-message",
    async ({ text, maxCycles, governanceStrictness, perfMode }) => {
      const input = typeof text === "string" ? text.trim() : "";
      if (!input) return;

      const goal =
        typeof socketState.governanceGoal === "string"
          ? socketState.governanceGoal
          : "";

      console.log("Chat-based workflow:", {
        input,
        goalPreview: goal.slice(0, 80),
        maxCycles,
        governanceStrictness,
        perfMode,
      });

      try {
        await runGovernedWorkflow(socket, {
          input,
          goal,
          maxCycles: normalizeMaxCycles(maxCycles),
          governanceStrictness: normalizeStrictness(governanceStrictness),
          perfMode: normalizePerfMode(perfMode),
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
      console.log("Starting workflow:", {
        input,
        goal,
        maxCycles,
        governanceStrictness,
        perfMode,
      });

      try {
        await runGovernedWorkflow(socket, {
          input,
          goal,
          maxCycles: normalizeMaxCycles(maxCycles),
          governanceStrictness: normalizeStrictness(governanceStrictness),
          perfMode: normalizePerfMode(perfMode),
        });
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

// -----------------------------------------------------------------------------
// Start Server
// -----------------------------------------------------------------------------

server.listen(PORT, () => {
  console.log(`cd\\ai MVP server running on port ${PORT}`);
});
