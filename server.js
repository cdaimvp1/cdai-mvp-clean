require("dotenv").config();

const path = require("path");
const express = require("express");
const http = require("http");
const session = require("express-session");
const { Server } = require("socket.io");

// Externalized workflow engine (NEW CLEAN LAYER)
const runGovernedWorkflow = require("./workflow/runGovernedWorkflow.js");

// -----------------------------------------------------------------------------
// Port Configuration
// -----------------------------------------------------------------------------
const PORT = process.env.PORT ? Number(process.env.PORT) : 5003;
if (!PORT || Number.isNaN(PORT)) {
  console.error("ERROR: Invalid port configuration.");
  process.exit(1);
}

// -----------------------------------------------------------------------------
// Secrets / Passwords
// -----------------------------------------------------------------------------
const SESSION_PASSWORD = process.env.SESSION_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!SESSION_PASSWORD) {
  console.error("ERROR: SESSION_PASSWORD missing from .env");
  process.exit(1);
}
if (!SESSION_SECRET) {
  console.error("ERROR: SESSION_SECRET missing from .env");
  process.exit(1);
}
if (!OPENAI_API_KEY) {
  console.warn("WARNING: OPENAI_API_KEY missing — governed workflow will fail.");
}

// -----------------------------------------------------------------------------
// Express App + Server
// -----------------------------------------------------------------------------
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Body parser for login POST
app.use(express.json());

// Session middleware
const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 60 * 60 * 1000 }
});

// Attach session to HTTP and WebSocket
app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

// -----------------------------------------------------------------------------
// Headers (allow embedding, etc.)
// -----------------------------------------------------------------------------
app.use((req, res, next) => {
  res.setHeader("X-Powered-By", "cdai-mvp");
  res.removeHeader("X-Frame-Options");
  res.setHeader("Content-Security-Policy", "frame-ancestors *");
  next();
});

// -----------------------------------------------------------------------------
// Static File Serving (IMPORTANT & CORRECT FOR YOUR STRUCTURE)
// -----------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, "public")));
app.use("/assets", express.static(path.join(__dirname, "public", "assets")));

// -----------------------------------------------------------------------------
// Authentication Helpers
// -----------------------------------------------------------------------------
function isAuthenticated(req) {
  return req.session && req.session.authenticated;
}

function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  return res.redirect("/login");
}

// -----------------------------------------------------------------------------
// Routes: Login
// -----------------------------------------------------------------------------
app.get("/login", (req, res) => {
  if (isAuthenticated(req)) return res.redirect("/");
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/auth/login", (req, res) => {
  const { password } = req.body || {};
  if (password === SESSION_PASSWORD) {
    req.session.authenticated = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: "Invalid password" });
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// -----------------------------------------------------------------------------
// Protected Main App
// -----------------------------------------------------------------------------
app.get("/", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Health endpoint
app.get("/health", (req, res) => res.json({ ok: true }));

// -----------------------------------------------------------------------------
// SOCKET.IO — Governed MCP runtime
// -----------------------------------------------------------------------------
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Per-socket governance state
  const socketState = {
    governanceGoal: null
  };

  // Receive governance rules
  socket.on("submit-governance", ({ goal }) => {
    const normalized = typeof goal === "string" ? goal.trim() : "";
    socketState.governanceGoal = normalized || null;

    const rules = parseRules(normalized);
    socket.emit("telemetry", {
      type: "governance-rules",
      rules
    });
  });

  socket.on("reset-governance", () => {
    socketState.governanceGoal = null;
    socket.emit("telemetry", {
      type: "governance-rules",
      rules: []
    });
  });

  // Reset conversation log
  socket.on("reset-conversation", () => {
    socket.emit("telemetry", { type: "reset" });
  });

  // CHAT-BASED TASK EXECUTION (preferred pathway)
  socket.on("chat-message", async ({ text, maxCycles, governanceStrictness, perfMode }) => {
    const input = (text || "").trim();
    if (!input) return;

    const goal = socketState.governanceGoal || "";

    try {
      await runGovernedWorkflow(socket, {
        input,
        goal,
        maxCycles,
        governanceStrictness,
        perfMode
      });
    } catch (err) {
      console.error("Workflow Error:", err);
      socket.emit("telemetry", {
        type: "mcp-status",
        status: "Error",
        detail: "An error occurred while running the governed workflow."
      });
    }
  });

  // Legacy execution path
  socket.on("run-workflow", async ({ input, goal, maxCycles, governanceStrictness, perfMode }) => {
    try {
      await runGovernedWorkflow(socket, {
        input,
        goal,
        maxCycles,
        governanceStrictness,
        perfMode
      });
    } catch (err) {
      console.error("Workflow Error:", err);
      socket.emit("telemetry", {
        type: "mcp-status",
        status: "Error",
        detail: "An error occurred while running the governed workflow."
      });
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// -----------------------------------------------------------------------------
// Utility: Rule Parser
// -----------------------------------------------------------------------------
function parseRules(goalText) {
  if (!goalText) return [];
  return goalText
    .split(/\n|;/)
    .map((r) => r.trim())
    .filter(Boolean);
}
// -----------------------------------------------------------------------------
// Serve Front-End (Important for Render)
// -----------------------------------------------------------------------------

// Serve the index.html for the main app
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Wildcard route — send index.html for any unknown path
// This is CRITICAL for Render deployments
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// -----------------------------------------------------------------------------
// Start Server
// -----------------------------------------------------------------------------
server.listen(PORT, () => {
  console.log(`cd\\ai MVP server running on port ${PORT}`);
});
