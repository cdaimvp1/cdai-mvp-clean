require("dotenv").config();

const path = require("path");
const express = require("express");
const http = require("http");
const session = require("express-session");
const { Server } = require("socket.io");

// --- Config ------------------------------------------------------------------

// Render will always inject process.env.PORT.
// Locally we default to 5002.
const PORT = process.env.PORT || 5002;

// Demo password & session secret
const DEMO_PASSWORD = "hpxCK2PUzh8*67pEB!3E";
const SESSION_SECRET = process.env.SESSION_SECRET || "change-this-session-secret";

// OpenAI
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL_NAME = "gpt-4o";

if (!OPENAI_API_KEY) {
  console.warn("WARNING: OPENAI_API_KEY is not set. The workflow will fail until you set it in .env or Render env vars.");
}

// --- App & middleware --------------------------------------------------------

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

// Attach session to HTTP requests
app.use(sessionMiddleware);

// CORS-like basic header
app.use((req, res, next) => {
  res.setHeader("X-Powered-By", "cd/ai mvp");
  next();
});

// --- Enable iframe embedding (WordPress, etc.) -------------------------------

// Remove X-Frame-Options if set by defaults
app.use((req, res, next) => {
  res.removeHeader("X-Frame-Options");
  res.setHeader("Content-Security-Policy", "frame-ancestors *");
  next();
});

// Share session with Socket.IO
io.engine.use(sessionMiddleware);

// --- Auth helpers ------------------------------------------------------------

function isAuthenticated(req) {
  return req.session && req.session.authenticated;
}

function requireAuth(req, res, next) {
  if (isAuthenticated(req)) {
    return next();
  }
  return res.redirect("/login");
}

// --- Static assets -----------------------------------------------------------

app.use("/static", express.static(path.join(__dirname, "public")));
app.use("/assets", express.static(path.join(__dirname, "public", "assets")));

// --- Routes: Login & Main App ------------------------------------------------

app.get("/login", (req, res) => {
  if (isAuthenticated(req)) return res.redirect("/");
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/auth/login", (req, res) => {
  const { password } = req.body || {};
  if (password === DEMO_PASSWORD) {
    req.session.authenticated = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: "Invalid password" });
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Protected main app
app.get("/", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Health endpoint for Render
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// --- Socket.IO workflow ------------------------------------------------------

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("run-workflow", async ({ input, goal, maxCycles, governanceStrictness }) => {
    console.log("Starting REAL workflow:", { input, goal, maxCycles, governanceStrictness });

    try {
      await runGovernedWorkflow(socket, {
        input,
        goal,
        maxCycles: normalizeMaxCycles(maxCycles),
        governanceStrictness: normalizeStrictness(governanceStrictness),
      });
    } catch (err) {
      console.error("Workflow error:", err);

      socket.emit("telemetry", {
        type: "mcp-status",
        status: "Error",
        detail: "An error occurred while running the governed workflow.",
      });

      socket.emit("telemetry", {
        type: "final-output",
        text: "An error occurred while running the governed workflow. Please try again.",
      });
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// --- Helpers ----------------------------------------------------------------

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

function initialValidationState() {
  return {
    forbiddenHits: [],
    wordCountOk: true,
    artifactsOk: true,
    impliedReliabilityOk: true,
    isCompliant: false,
  };
}

// --- Core Governed Workflow --------------------------------------------------

async function runGovernedWorkflow(socket, { input, goal, maxCycles, governanceStrictness }) {
  socket.emit("telemetry", { type: "reset" });

  const rules = parseRulesFromGoal(goal);
  const ledger = [];
  let converged = false;

  socket.emit("telemetry", { type: "cycle-plan", plannedCycles: maxCycles });
  socket.emit("telemetry", { type: "governance-rules", rules });

  socket.emit("telemetry", {
    type: "mcp-status",
    status: "Starting",
    detail: "Initializing governed workflow using real OpenAI calls…",
  });

  // --- Task Agent initial draft ---------------------------------------------

  const taskDraft = await callOpenAIChat({
    system: `
You are the Task Agent in a governed dual-hemisphere AI system (cd\\ai).
Produce an initial neutral draft based on the user input.
Do not over-optimize for governance; this is a baseline for refinement.
    `,
    user: `
User task:
${input}

Governance hints:
${rules.map((r,i)=>`${i+1}. ${r}`).join("\n") || "None provided."}
    `,
    temperature: 0.5,
  });

  let currentText = taskDraft || `Initial draft based on: "${input}"`;

  ledger.push({
    timestamp: new Date().toISOString(),
    stage: "TaskAgent",
    cycle: 0,
    summary: "Initial draft generated by Task Agent.",
    snippet: currentText.slice(0, 260),
  });

  socket.emit("telemetry", {
    type: "hemisphere-log",
    hemisphere: "A",
    message: "Task Agent produced the first draft.",
  });

  // --- Dual-Hemisphere Cycles ------------------------------------------------

  let validation = initialValidationState();

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    socket.emit("telemetry", { type: "cycle-update", cycle });

    // ---- Analytical
    socket.emit("telemetry", {
      type: "mcp-status",
      status: "Analytical Pass",
      detail: `Cycle ${cycle}: enforcing governance constraints.`,
    });

    const analyticalResult = await analyticalPass(currentText, {
      input,
      rules,
      governanceStrictness,
    });

    currentText = analyticalResult.rewrittenText;
    validation = analyticalResult.validation;

    ledger.push({
      timestamp: new Date().toISOString(),
      stage: "Analytical",
      cycle,
      summary: analyticalResult.deltaSummary,
      snippet: currentText.slice(0, 260),
    });

    socket.emit("telemetry", {
      type: "hemisphere-log",
      hemisphere: "A",
      message: `Cycle ${cycle}: ${analyticalResult.deltaSummary}`,
    });

    // ---- Creative
    socket.emit("telemetry", {
      type: "mcp-status",
      status: "Creative Pass",
      detail: `Cycle ${cycle}: refining tone and clarity.`,
    });

    const creativeResult = await creativePass(currentText, {
      input,
      rules,
      governanceStrictness,
      analyticalDirectives: analyticalResult.directives,
    });

    currentText = creativeResult.rewrittenText;

    ledger.push({
      timestamp: new Date().toISOString(),
      stage: "Creative",
      cycle,
      summary: creativeResult.deltaSummary,
      snippet: currentText.slice(0, 260),
    });

    socket.emit("telemetry", {
      type: "hemisphere-log",
      hemisphere: "B",
      message: `Cycle ${cycle}: ${creativeResult.deltaSummary}`,
    });

    // ---- Validator
    const postCreativeValidation = await validatorPass(currentText, {
      input,
      rules,
      governanceStrictness,
    });

    validation = postCreativeValidation;

    ledger.push({
      timestamp: new Date().toISOString(),
      stage: "Validator",
      cycle,
      summary: validationSummary(validation),
      snippet: currentText.slice(0, 260),
    });

    if (validation.isCompliant) {
      converged = true;
      break;
    }
  }

  socket.emit("telemetry", { type: "governance-rules-final" });
  socket.emit("telemetry", {
    type: "mcp-status",
    status: "Finalized",
    detail: converged
      ? "Governed output locked after convergence."
      : "Locked after max cycles (fail-safe stop).",
  });

  socket.emit("telemetry", { type: "ledger", entries: ledger });
  socket.emit("telemetry", { type: "final-output", text: currentText });
}

// --- Analytical, Creative, Validator Passes ---------------------------------

async function analyticalPass(currentText, { input, rules, governanceStrictness }) {
  const system = `
You are the ANALYTICAL hemisphere. Enforce governance. Return JSON ONLY.
  `;
  const user = `
Task:
${input}

Rules:
${rules.join("\n")}

Draft:
${currentText}

Strictness: ${governanceStrictness}
  `;

  const raw = await callOpenAIChat({
    system,
    user,
    temperature: 0.2,
    response_format: "json",
  });

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      rewrittenText: currentText,
      directives: [],
      validation: initialValidationState(),
      deltaSummary: "Analytical hemisphere parsing issue; using previous draft.",
    };
  }

  return {
    rewrittenText: parsed.rewrittenText || currentText,
    directives: Array.isArray(parsed.directives) ? parsed.directives : [],
    validation: { ...initialValidationState(), ...(parsed.validation || {}) },
    deltaSummary: parsed.deltaSummary || "Analytical hemisphere updated structure/tone.",
  };
}

async function creativePass(currentText, { input, rules, governanceStrictness, analyticalDirectives }) {
  const system = `
You are the CREATIVE hemisphere. Improve readability within constraints. JSON ONLY.
  `;
  const user = `
Task:
${input}

Rules:
${rules.join("\n")}

Draft:
${currentText}

Directives:
${JSON.stringify(analyticalDirectives || [])}

Strictness: ${governanceStrictness}
  `;

  const raw = await callOpenAIChat({
    system,
    user,
    temperature: 0.4,
    response_format: "json",
  });

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      rewrittenText: currentText,
      deltaSummary: "Creative hemisphere parsing issue; preserved prior draft.",
    };
  }

  return {
    rewrittenText: parsed.rewrittenText || currentText,
    deltaSummary: parsed.deltaSummary || "Creative hemisphere refined clarity and tone.",
  };
}

async function validatorPass(text, { input, rules, governanceStrictness }) {
  const system = `
You are the Validator. Check for violations. JSON ONLY.
  `;

  const user = `
Task:
${input}

Rules:
${rules.join("\n")}

Text to validate:
${text}

Strictness: ${governanceStrictness}
  `;

  const raw = await callOpenAIChat({
    system,
    user,
    temperature: 0.0,
    response_format: "json",
  });

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return initialValidationState();
  }

  const base = initialValidationState();
  const merged = { ...base, ...parsed };

  merged.isCompliant =
    merged.wordCountOk &&
    merged.artifactsOk &&
    merged.impliedReliabilityOk &&
    (merged.forbiddenHits || []).length === 0;

  return merged;
}

function validationSummary(v) {
  const issues = [];
  if (!v.wordCountOk) issues.push("WORD_COUNT");
  if (!v.artifactsOk) issues.push("ARTIFACTS");
  if (!v.impliedReliabilityOk) issues.push("IMPLIED_RELIABILITY");
  if (v.forbiddenHits?.length) issues.push(`FORBIDDEN: ${v.forbiddenHits.join(", ")}`);
  return issues.length ? `Violations: ${issues.join("; ")}` : "All constraints satisfied.";
}

// --- OpenAI Helper -----------------------------------------------------------

async function callOpenAIChat({ system, user, temperature = 0.4, response_format }) {
  if (!OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY missing.");
    return null;
  }

  try {
    const body = {
      model: MODEL_NAME,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature,
    };

    if (response_format === "json") {
      body.response_format = { type: "json_object" };
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("OpenAI error:", response.status, text);
      return null;
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error("OpenAI call error:", err);
    return null;
  }
}

// --- Rules Parser ------------------------------------------------------------

function parseRulesFromGoal(goalText) {
  if (!goalText) return [];
  const pieces = goalText
    .split(/\n|;/)
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  return pieces.length ? pieces : [goalText.trim()];
}

// --- Start server ------------------------------------------------------------

server.listen(PORT, () => {
  console.log(`cd/ai governed MVP listening on http://localhost:${PORT}`);
});
