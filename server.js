require("dotenv").config();

const path = require("path");
const express = require("express");
const http = require("http");
const session = require("express-session");
const { Server } = require("socket.io");

// --- Config ------------------------------------------------------------------

const PORT = process.env.PORT || 6000; // you can change to 5001/6000/etc

// Demo password & session secret
const DEMO_PASSWORD = "hpxCK2PUzh8*67pEB!3E";
const SESSION_SECRET = process.env.SESSION_SECRET || "change-this-session-secret";

// OpenAI
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL_NAME = "gpt-4o";

if (!OPENAI_API_KEY) {
  console.warn("WARNING: OPENAI_API_KEY is not set. The workflow will fail until you set it in .env.");
}

// --- App & middleware --------------------------------------------------------

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Parse JSON bodies (for /auth/login)
app.use(express.json());

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

// (Optional) basic CORS for dev
app.use((req, res, next) => {
  res.setHeader("X-Powered-By", "cd/ai mvp");
  next();
});

// Share session with Socket.IO (not strictly necessary for demo auth,
// but keeps request + socket aligned if you ever want deeper control)
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

// Static JS/CSS/etc under /static
app.use("/static", express.static(path.join(__dirname, "public")));

// Logos & other assets
app.use("/assets", express.static(path.join(__dirname, "public", "assets")));

// --- Routes: login & app -----------------------------------------------------

app.get("/login", (req, res) => {
  // If already logged in, go straight to app
  if (isAuthenticated(req)) {
    return res.redirect("/");
  }
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
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// Main app (protected)
app.get("/", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Simple health check (Render/Fly friendly)
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// --- Socket.IO: governed workflow -------------------------------------------

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("run-workflow", async ({ input, goal, maxCycles, governanceStrictness }) => {
    console.log("Starting REAL workflow for:", { input, goal, maxCycles, governanceStrictness });

    try {
      await runGovernedWorkflow(socket, {
        input,
        goal,
        maxCycles: normalizeMaxCycles(maxCycles),
        governanceStrictness: normalizeStrictness(governanceStrictness),
      });
    } catch (err) {
      console.error("Error in runGovernedWorkflow:", err);
      socket.emit("telemetry", {
        type: "mcp-status",
        status: "Error",
        detail: "An error occurred while running the governed workflow. Check server logs.",
      });
      socket.emit("telemetry", {
        type: "final-output",
        text: "An error occurred while running the governed workflow. Please try again later.",
      });
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// --- Helpers for config ------------------------------------------------------

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

// --- Core governed workflow --------------------------------------------------

// Simple validation result object
function initialValidationState() {
  return {
    forbiddenHits: [],
    wordCountOk: true,
    artifactsOk: true,
    impliedReliabilityOk: true,
    isCompliant: false,
  };
}

async function runGovernedWorkflow(socket, { input, goal, maxCycles, governanceStrictness }) {
  // Reset UI
  socket.emit("telemetry", { type: "reset" });

  const rules = parseRulesFromGoal(goal);

  // Inform client of plan (max cycles, but we may stop earlier)
  socket.emit("telemetry", {
    type: "cycle-plan",
    plannedCycles: maxCycles,
  });

  socket.emit("telemetry", {
    type: "governance-rules",
    rules,
  });

  socket.emit("telemetry", {
    type: "mcp-status",
    status: "Starting",
    detail: "Initializing governed workflow with real OpenAI calls across both hemispheres…",
  });

  const ledger = [];

  // --- Task Agent: initial neutral draft ------------------------------------

  const taskDraft = await callOpenAIChat({
    system: `
You are the Task Agent in a governed dual-hemisphere AI system (cd\\ai).
Your job is to produce an initial neutral draft based on the user task input.
Do NOT over-optimize for governance yet. Provide a clear, direct first version
that the hemispheres can refine.
    `,
    user: `
User task:
${input}

High-level governance hints (for awareness only at this stage):
${rules.map((r, i) => `${i + 1}. ${r}`).join("\n") || "None provided."}
    `,
    temperature: 0.5,
  });

  let draft = taskDraft || `Initial draft based on input: "${input}"`;

  ledger.push({
    timestamp: new Date().toISOString(),
    stage: "TaskAgent",
    cycle: 0,
    summary: "Initial draft generated by Task Agent.",
    snippet: draft.slice(0, 260),
  });

  socket.emit("telemetry", {
    type: "hemisphere-log",
    hemisphere: "A",
    message: "Task Agent produced an initial neutral draft.",
  });

  // --- Cyclic dual-hemisphere passes ----------------------------------------

  let currentText = draft;
  let validation = initialValidationState();
  let converged = false;

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    socket.emit("telemetry", {
      type: "cycle-update",
      cycle,
    });

    // ANALYTICAL HEMISPHERE: enforces governance, generates directives + deltas
    socket.emit("telemetry", {
      type: "mcp-status",
      status: "Analytical Pass",
      detail: `Cycle ${cycle}: Analytical hemisphere enforcing structure, risk, and governance constraints.`,
    });

    const analyticalResult = await analyticalPass(currentText, {
      input,
      rules,
      governanceStrictness,
    });

    currentText = analyticalResult.rewrittenText;
    validation = analyticalResult.validation;

    socket.emit("telemetry", {
      type: "hemisphere-log",
      hemisphere: "A",
      message: `Cycle ${cycle}: ${analyticalResult.deltaSummary}`,
    });

    ledger.push({
      timestamp: new Date().toISOString(),
      stage: "Analytical",
      cycle,
      summary: analyticalResult.deltaSummary,
      snippet: currentText.slice(0, 260),
    });

    // CREATIVE HEMISPHERE: applies directives proportionally
    socket.emit("telemetry", {
      type: "mcp-status",
      status: "Creative Pass",
      detail: `Cycle ${cycle}: Creative hemisphere refining tone and readability under analytical constraints.`,
    });

    const creativeResult = await creativePass(currentText, {
      input,
      rules,
      governanceStrictness,
      analyticalDirectives: analyticalResult.directives,
    });

    currentText = creativeResult.rewrittenText;

    socket.emit("telemetry", {
      type: "hemisphere-log",
      hemisphere: "B",
      message: `Cycle ${cycle}: ${creativeResult.deltaSummary}`,
    });

    ledger.push({
      timestamp: new Date().toISOString(),
      stage: "Creative",
      cycle,
      summary: creativeResult.deltaSummary,
      snippet: currentText.slice(0, 260),
    });

    // Update governance rules progress (purely visual for now)
    socket.emit("telemetry", {
      type: "governance-rules-progress",
      cycle,
    });

    // Re-run lightweight validation AFTER creative pass
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
      summary: `Validator after cycle ${cycle}: ${validationSummary(validation)}`,
      snippet: currentText.slice(0, 260),
    });

    if (validation.isCompliant) {
      converged = true;
      break;
    }
  }

  socket.emit("telemetry", {
    type: "governance-rules-final",
  });

  socket.emit("telemetry", {
    type: "mcp-status",
    status: "Finalized",
    detail: converged
      ? "Governed output locked after dual-hemisphere convergence."
      : "Governed output locked after reaching max cycles (fail-safe stop).",
  });

  // Ship ledger
  socket.emit("telemetry", {
    type: "ledger",
    entries: ledger,
  });

  // Final governed output
  socket.emit("telemetry", {
    type: "final-output",
    text: currentText,
  });
}

// --- Pass implementations ----------------------------------------------------

async function analyticalPass(currentText, { input, rules, governanceStrictness }) {
  const system = `
You are the ANALYTICAL hemisphere in a governed dual-hemisphere system.
Your job is to ENFORCE governance and generate structured directives.

Steps:
1. Identify any governance violations in the current draft
   (forbidden terms, word-band issues, tone problems, missing artifacts, etc.).
2. Rewrite the draft to reduce violations.
3. Produce a set of directives with weights in [0.0, 1.0] indicating how strongly
   the Creative hemisphere should apply them.
4. Provide a 1–2 sentence delta summary explaining what changed this cycle.

Output JSON ONLY with the following shape (no markdown, no commentary):

{
  "rewrittenText": "...",
  "directives": [
    { "type": "length", "weight": 0.7, "note": "Shorten to fit word band" },
    { "type": "forbidden_terms", "weight": 1.0, "note": "Remove or neutralize banned words" },
    { "type": "tone", "weight": 0.6, "note": "Firm but partnership-oriented" },
    { "type": "structure", "weight": 0.8, "note": "Clarify requests as bullet-like segments" }
  ],
  "validation": {
    "forbiddenHits": ["fairness", "drift"],
    "wordCountOk": false,
    "artifactsOk": true,
    "impliedReliabilityOk": true,
    "isCompliant": false
  },
  "deltaSummary": "Shortened the message and removed explicit references to fairness and drift while preserving key vendor requests."
}

IMPORTANT:
- Respect the user's task intent.
- Use the governance rules as hard constraints.
- The 'weight' fields SHOULD reflect how aggressively the Creative side should follow each directive,
  bounded by the governanceStrictness scalar (higher strictness => generally higher weights).
  However, keep weights interpretable; do not simply copy governanceStrictness.
  Instead, combine your assessment with that scalar.
`;

  const user = `
User task:
${input}

Governance rules:
${rules.map((r, i) => `${i + 1}. ${r}`).join("\n") || "None provided."}

Current draft:
${currentText}

Governance strictness scalar (0.0–1.0):
${governanceStrictness}
`;

  const raw = await callOpenAIChat({ system, user, temperature: 0.2, response_format: "json" });

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error("Analytical pass JSON parse error:", e, raw);
    return {
      rewrittenText: currentText,
      directives: [],
      validation: initialValidationState(),
      deltaSummary: "Analytical hemisphere encountered a parsing issue; conservatively preserved prior draft.",
    };
  }

  return {
    rewrittenText: parsed.rewrittenText || currentText,
    directives: Array.isArray(parsed.directives) ? parsed.directives : [],
    validation: {
      ...initialValidationState(),
      ...(parsed.validation || {}),
    },
    deltaSummary:
      parsed.deltaSummary ||
      "Analytical hemisphere enforced governance and structural constraints for this cycle.",
  };
}

async function creativePass(currentText, { input, rules, governanceStrictness, analyticalDirectives }) {
  const system = `
You are the CREATIVE hemisphere in a governed dual-hemisphere system.
Your job is to improve readability, nuance, and executive suitability WITHOUT breaking governance.

You receive:
- The current governed draft.
- A set of analytical directives with weights in [0.0, 1.0].
- A governanceStrictness scalar (0.0–1.0).

Your behavior:
- Apply the directives proportionally to their weights and the strictness scalar.
- Do NOT introduce forbidden concepts or break constraints.
- Keep tone firm but partnership-oriented where requested.
- Provide a 1–2 sentence delta summary focused on what changed THIS cycle.

Output JSON ONLY:

{
  "rewrittenText": "...",
  "deltaSummary": "..."
}
`;

  const user = `
User task:
${input}

Governance rules:
${rules.map((r, i) => `${i + 1}. ${r}`).join("\n") || "None provided."}

Current governed draft from Analytical:
${currentText}

Analytical directives with weights:
${JSON.stringify(analyticalDirectives || [], null, 2)}

Governance strictness scalar:
${governanceStrictness}
`;

  const raw = await callOpenAIChat({ system, user, temperature: 0.35, response_format: "json" });

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error("Creative pass JSON parse error:", e, raw);
    return {
      rewrittenText: currentText,
      deltaSummary: "Creative hemisphere encountered a parsing issue; preserved prior draft.",
    };
  }

  return {
    rewrittenText: parsed.rewrittenText || currentText,
    deltaSummary:
      parsed.deltaSummary ||
      "Creative hemisphere refined tone and clarity while preserving analytical constraints.",
  };
}

async function validatorPass(text, { input, rules, governanceStrictness }) {
  const system = `
You are the Validator in a governed dual-hemisphere system.
Your role is to evaluate whether the CURRENT draft satisfies all governance rules.

Consider:
- Forbidden terms and obvious synonyms.
- Word-count bands.
- Artifact/attachment count requirements (conceptually, not actual attachments).
- Tone constraints.
- Implied reliability statements when they are explicitly forbidden.

Respond in JSON ONLY:

{
  "forbiddenHits": ["word1", "word2"],
  "wordCountOk": true,
  "artifactsOk": false,
  "impliedReliabilityOk": true,
  "isCompliant": false
}
`;

  const user = `
User task:
${input}

Governance rules:
${rules.map((r, i) => `${i + 1}. ${r}`).join("\n") || "None provided."}

Current draft to validate:
${text}

Governance strictness scalar:
${governanceStrictness}
`;

  const raw = await callOpenAIChat({ system, user, temperature: 0.0, response_format: "json" });

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error("Validator JSON parse error:", e, raw);
    return initialValidationState();
  }

  const base = initialValidationState();
  const merged = { ...base, ...parsed };
  merged.isCompliant =
    merged.wordCountOk && merged.artifactsOk && merged.impliedReliabilityOk && (merged.forbiddenHits || []).length === 0;

  return merged;
}

function validationSummary(v) {
  const problems = [];
  if (!v.wordCountOk) problems.push("WORD_BAND");
  if (!v.artifactsOk) problems.push("ARTIFACT_COUNT");
  if (!v.impliedReliabilityOk) problems.push("IMPLIED_RELIABILITY");
  if (v.forbiddenHits && v.forbiddenHits.length > 0) {
    problems.push(`FORBIDDEN:[${v.forbiddenHits.join(", ")}]`);
  }
  if (problems.length === 0) return "All constraints satisfied.";
  return `Constraints violated: ${problems.join("; ")}`;
}

// --- OpenAI helper -----------------------------------------------------------

async function callOpenAIChat({ system, user, temperature = 0.4, response_format }) {
  if (!OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is missing. Cannot call OpenAI.");
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
      const errText = await response.text();
      console.error("OpenAI API error:", response.status, errText);
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim() || null;
    return content;
  } catch (err) {
    console.error("Error calling OpenAI:", err);
    return null;
  }
}

// --- Rules parsing -----------------------------------------------------------

function parseRulesFromGoal(goalText) {
  if (!goalText) return [];
  const rawPieces = goalText
    .split(/\n|;/)
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  if (rawPieces.length === 0) return [goalText.trim()];
  return rawPieces;
}

// --- Start server ------------------------------------------------------------

server.listen(PORT, () => {
  console.log(`cd/ai governed MVP listening on http://localhost:${PORT}`);
});
