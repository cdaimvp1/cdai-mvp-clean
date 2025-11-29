require("dotenv").config();

const path = require("path");
const express = require("express");
const http = require("http");
const session = require("express-session");
const { Server } = require("socket.io");

// --- Config ------------------------------------------------------------------

// Render will inject PORT in production; locally default to 5002.
const PORT = process.env.PORT || 5002;

// Demo password & session secret
const DEMO_PASSWORD = "hpxCK2PUzh8*67pEB!3E";
const SESSION_SECRET =
  process.env.SESSION_SECRET || "change-this-session-secret";

// OpenAI
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL_NAME = "gpt-4o";

if (!OPENAI_API_KEY) {
  console.warn(
    "WARNING: OPENAI_API_KEY is not set. The workflow will fail until you set it in .env or Render env vars."
  );
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

// Simple header
app.use((req, res, next) => {
  res.setHeader("X-Powered-By", "cd/ai mvp");
  next();
});

// Allow iframe embedding (for WordPress, etc.)
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
  if (isAuthenticated(req)) return next();
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

  socket.on(
    "run-workflow",
    async ({ input, goal, maxCycles, governanceStrictness, mode }) => {
      console.log("Starting workflow:", {
        input,
        goal,
        maxCycles,
        governanceStrictness,
        mode,
      });

      try {
        await runGovernedWorkflow(socket, {
          input,
          goal,
          maxCycles: normalizeMaxCycles(maxCycles),
          governanceStrictness: normalizeStrictness(governanceStrictness),
          mode: normalizeMode(mode),
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
          text:
            "An error occurred while running the governed workflow. Please try again.",
        });
      }
    }
  );

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// --- Normalizers & helpers ---------------------------------------------------

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

function normalizeMode(raw) {
  const val = String(raw || "").toLowerCase();
  if (val === "fast") return "fast";
  if (val === "turbo") return "turbo";
  return "real";
}

function modeConfig(mode) {
  switch (mode) {
    case "fast":
      return {
        label: "Fast",
        minCycles: 1,
        analyticalTemperature: 0.18,
        creativeTemperature: 0.35,
        validatorTemperature: 0.0,
        useTurboPass: false,
        useRealModerator: false,
      };
    case "turbo":
      return {
        label: "Turbo",
        minCycles: 1,
        turboTemperature: 0.4,
        useTurboPass: true,
        useRealModerator: false,
      };
    default:
      return {
        label: "Real",
        minCycles: 2, // ensures at least 2 visible cycles
        analyticalTemperature: 0.2,
        creativeTemperature: 0.4,
        validatorTemperature: 0.0,
        useTurboPass: false,
        useRealModerator: true,
      };
  }
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

async function runGovernedWorkflow(
  socket,
  { input, goal, maxCycles, governanceStrictness, mode }
) {
  const cfg = modeConfig(mode);

  socket.emit("telemetry", { type: "reset" });

  const rules = parseRulesFromGoal(goal);
  const ledger = [];
  let converged = false;

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
    detail: `Initializing governed workflow in ${cfg.label} mode…`,
  });

  // --- Task Agent initial draft ---------------------------------------------

  const taskDraft = await callOpenAIChat({
    system: `
You are the Task Agent in a governed dual-hemisphere system (cd\\ai).
Generate an initial, neutral draft based on the user task.
Do not optimize heavily for governance yet; this is a baseline.
Return ONLY the draft text, no commentary.
    `,
    user: `
User task:
${input}

Contextual governance hints:
${rules.map((r, i) => `${i + 1}. ${r}`).join("\n") || "None provided."}
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
    message: "Task Agent produced an initial neutral draft.",
  });

  let validation = initialValidationState();

  // --- Cycles ---------------------------------------------------------------

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    socket.emit("telemetry", { type: "cycle-update", cycle });
    socket.emit("telemetry", {
      type: "governance-rules-progress",
      cycle,
    });

    if (cfg.useTurboPass) {
      // ---- TURBO: single OpenAI call per cycle -----------------------------
      const turboResult = await turboCyclePass(currentText, {
        input,
        rules,
        governanceStrictness,
        temperature: cfg.turboTemperature,
        cycle,
      });

      currentText = turboResult.rewrittenText;
      validation = turboResult.validation;

      // Analytical log & ledger
      ledger.push({
        timestamp: new Date().toISOString(),
        stage: "Analytical",
        cycle,
        summary: turboResult.analyticalSummary,
        snippet: currentText.slice(0, 260),
      });
      socket.emit("telemetry", {
        type: "hemisphere-log",
        hemisphere: "A",
        message: `Cycle ${cycle}: ${turboResult.analyticalSummary}`,
      });

      // Creative log & ledger
      ledger.push({
        timestamp: new Date().toISOString(),
        stage: "Creative",
        cycle,
        summary: turboResult.creativeSummary,
        snippet: currentText.slice(0, 260),
      });
      socket.emit("telemetry", {
        type: "hemisphere-log",
        hemisphere: "B",
        message: `Cycle ${cycle}: ${turboResult.creativeSummary}`,
      });

      // Validator ledger
      ledger.push({
        timestamp: new Date().toISOString(),
        stage: "Validator",
        cycle,
        summary: validationSummary(validation),
        snippet: currentText.slice(0, 260),
      });
    } else {
      // ---- REAL / FAST: Analytical → Moderator → Creative → Validator -----

      // Analytical pass
      socket.emit("telemetry", {
        type: "mcp-status",
        status: "Analytical Pass",
        detail: `Cycle ${cycle}: Analytical hemisphere enforcing governance rules.`,
      });

      const analyticalResult = await analyticalPass(currentText, {
        input,
        rules,
        governanceStrictness,
        temperature: cfg.analyticalTemperature,
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

      // Moderator (Mediator) – refines directives for Creative
      const mediatorResult = await mediatorPass(analyticalResult.directives, {
        governanceStrictness,
        useRealModel: cfg.useRealModerator,
      });

      ledger.push({
        timestamp: new Date().toISOString(),
        stage: "Mediator",
        cycle,
        summary: mediatorResult.summary,
        snippet: (mediatorResult.creativeInstructions || [])
          .join(" ")
          .slice(0, 260),
      });

      // Creative pass
      socket.emit("telemetry", {
        type: "mcp-status",
        status: "Creative Pass",
        detail: `Cycle ${cycle}: Creative hemisphere refining tone and readability.`,
      });

      const creativeResult = await creativePass(currentText, {
        input,
        rules,
        governanceStrictness,
        temperature: cfg.creativeTemperature,
        creativeInstructions: mediatorResult.creativeInstructions,
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

      // Validator
      const postCreativeValidation = await validatorPass(currentText, {
        input,
        rules,
        governanceStrictness,
        temperature: cfg.validatorTemperature,
      });

      validation = postCreativeValidation;

      ledger.push({
        timestamp: new Date().toISOString(),
        stage: "Validator",
        cycle,
        summary: validationSummary(validation),
        snippet: currentText.slice(0, 260),
      });
    }

    // Convergence check
    if (validation.isCompliant && cycle >= cfg.minCycles) {
      converged = true;
      break;
    }
  }

  socket.emit("telemetry", { type: "governance-rules-final" });
  socket.emit("telemetry", {
    type: "mcp-status",
    status: "Finalized",
    detail: converged
      ? `Governed output locked after dual-hemisphere convergence (${modeConfig(
          mode
        ).label} mode).`
      : `Locked after max cycles (${maxCycles}) in ${
          modeConfig(mode).label
        } mode (fail-safe stop).`,
  });

  socket.emit("telemetry", { type: "ledger", entries: ledger });
  socket.emit("telemetry", { type: "final-output", text: currentText });
}

// --- Passes: Analytical, Mediator, Creative, Validator, Turbo ----------------

async function analyticalPass(
  currentText,
  { input, rules, governanceStrictness, temperature }
) {
  const system = `
You are the ANALYTICAL hemisphere in a governed dual-hemisphere AI system.
Your job:
- Enforce structure, clarity, and governance constraints.
- Remove forbidden terms or risky phrasing.
- Tighten length and focus while preserving the user's intent.

Return STRICT JSON with:
{
  "rewrittenText": "<string>",
  "deltaSummary": "<1-2 short sentences describing what you changed>",
  "directives": ["<bullet directive for the creative hemisphere>", ...],
  "validation": {
    "forbiddenHits": ["term", ...],
    "wordCountOk": true/false,
    "artifactsOk": true/false,
    "impliedReliabilityOk": true/false
  }
}
`;
  const user = `
User task:
${input}

Governance rules:
${rules.join("\n")}

Current draft:
${currentText}

Strictness: ${governanceStrictness}
`;

  const raw = await callOpenAIChat({
    system,
    user,
    temperature,
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
      deltaSummary:
        "Analytical hemisphere encountered a parsing issue; preserved the previous draft.",
    };
  }

  const baseValidation = initialValidationState();
  const mergedValidation = { ...baseValidation, ...(parsed.validation || {}) };

  mergedValidation.isCompliant =
    mergedValidation.wordCountOk &&
    mergedValidation.artifactsOk &&
    mergedValidation.impliedReliabilityOk &&
    (mergedValidation.forbiddenHits || []).length === 0;

  return {
    rewrittenText: parsed.rewrittenText || currentText,
    directives: Array.isArray(parsed.directives) ? parsed.directives : [],
    validation: mergedValidation,
    deltaSummary:
      parsed.deltaSummary ||
      "Analytical hemisphere updated structure and governance alignment.",
  };
}

async function mediatorPass(directives, { governanceStrictness, useRealModel }) {
  if (!directives || directives.length === 0) {
    return {
      creativeInstructions: [],
      summary: "Mediator received no explicit directives; passed draft through.",
    };
  }

  // FAST / TURBO: local light-weight mediator
  if (!useRealModel) {
    const joined = directives.join("; ");
    const truncated =
      joined.length > 220 ? joined.slice(0, 217) + "…" : joined;
    return {
      creativeInstructions: [truncated],
      summary:
        "Mediator compacted analytical directives into a short set of creative instructions.",
    };
  }

  // REAL: call OpenAI to refine directives
  const system = `
You are the MODERATOR between Analytical and Creative hemispheres.
Convert analytical directives into concise creative instructions.
Return STRICT JSON:
{
  "creativeInstructions": ["<short instruction>", ...],
  "summary": "<1 short sentence describing how you refined the directives>"
}
  `;
  const user = `
Analytical directives (governance strictness: ${governanceStrictness}):
${JSON.stringify(directives, null, 2)}
  `;

  const raw = await callOpenAIChat({
    system,
    user,
    temperature: 0.25,
    response_format: "json",
  });

  try {
    const parsed = JSON.parse(raw);
    return {
      creativeInstructions: Array.isArray(parsed.creativeInstructions)
        ? parsed.creativeInstructions
        : directives,
      summary:
        parsed.summary ||
        "Mediator refined analytical directives for the creative hemisphere.",
    };
  } catch {
    return {
      creativeInstructions: directives,
      summary:
        "Mediator encountered a parsing issue and passed analytical directives through unchanged.",
    };
  }
}

async function creativePass(
  currentText,
  { input, rules, governanceStrictness, temperature, creativeInstructions }
) {
  const system = `
You are the CREATIVE hemisphere in a governed dual-hemisphere system.
Your responsibilities:
- Improve readability, flow, and executive polish.
- Preserve the analytical hemisphere's governance corrections.
- Do NOT reintroduce forbidden terms or risky claims.

Return STRICT JSON:
{
  "rewrittenText": "<string>",
  "deltaSummary": "<1-2 short sentences describing how you improved tone and clarity>"
}
`;
  const user = `
User task:
${input}

Governance rules:
${rules.join("\n")}

Draft (after Analytical hemisphere):
${currentText}

Mediator instructions for this cycle:
${JSON.stringify(creativeInstructions || [], null, 2)}

Strictness: ${governanceStrictness}
`;

  const raw = await callOpenAIChat({
    system,
    user,
    temperature,
    response_format: "json",
  });

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      rewrittenText: currentText,
      deltaSummary:
        "Creative hemisphere encountered a parsing issue; kept the previous draft.",
    };
  }

  return {
    rewrittenText: parsed.rewrittenText || currentText,
    deltaSummary:
      parsed.deltaSummary ||
      "Creative hemisphere refined clarity, flow, and tone within constraints.",
  };
}

async function validatorPass(
  text,
  { input, rules, governanceStrictness, temperature }
) {
  const system = `
You are the VALIDATOR for a governed dual-hemisphere system.
You must evaluate whether the text satisfies all governance rules.
Pay special attention to:
- Forbidden terms (exact or close variants).
- Word-count constraints.
- Requirements for number and style of supporting artifacts.
- Any wording that implies unreliability, failure, or risk if forbidden.

Return STRICT JSON:
{
  "forbiddenHits": ["<term>", ...],
  "wordCountOk": true/false,
  "artifactsOk": true/false,
  "impliedReliabilityOk": true/false
}
`;
  const user = `
User task:
${input}

Governance rules:
${rules.join("\n")}

Text to validate:
${text}

Strictness: ${governanceStrictness}
`;

  const raw = await callOpenAIChat({
    system,
    user,
    temperature,
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

// TURBO mode: single OpenAI call per cycle
async function turboCyclePass(
  currentText,
  { input, rules, governanceStrictness, temperature, cycle }
) {
  const system = `
You are a combined ANALYTICAL + CREATIVE + VALIDATOR mode in a governed system.
For this cycle you must:
- Tighten governance alignment.
- Improve tone/readability.
- Assess whether all rules are now satisfied.

Return STRICT JSON:
{
  "rewrittenText": "<string>",
  "analyticalSummary": "<1-2 short sentences on structural/governance fixes>",
  "creativeSummary": "<1-2 short sentences on tone/readability changes>",
  "validation": {
    "forbiddenHits": ["<term>", ...],
    "wordCountOk": true/false,
    "artifactsOk": true/false,
    "impliedReliabilityOk": true/false
  }
}
`;
  const user = `
Cycle: ${cycle}

User task:
${input}

Governance rules:
${rules.join("\n")}

Current draft:
${currentText}

Strictness: ${governanceStrictness}
`;

  const raw = await callOpenAIChat({
    system,
    user,
    temperature,
    response_format: "json",
  });

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      rewrittenText: currentText,
      analyticalSummary:
        "Turbo cycle encountered a parsing issue; reused previous draft.",
      creativeSummary:
        "Turbo cycle encountered a parsing issue; reused previous draft.",
      validation: initialValidationState(),
    };
  }

  const baseValidation = initialValidationState();
  const mergedValidation = {
    ...baseValidation,
    ...(parsed.validation || {}),
  };

  mergedValidation.isCompliant =
    mergedValidation.wordCountOk &&
    mergedValidation.artifactsOk &&
    mergedValidation.impliedReliabilityOk &&
    (mergedValidation.forbiddenHits || []).length === 0;

  return {
    rewrittenText: parsed.rewrittenText || currentText,
    analyticalSummary:
      parsed.analyticalSummary ||
      "Analytical portion tightened structure and governance alignment.",
    creativeSummary:
      parsed.creativeSummary ||
      "Creative portion refined tone and readability for executives.",
    validation: mergedValidation,
  };
}

function validationSummary(v) {
  const issues = [];
  if (!v.wordCountOk) issues.push("WORD_COUNT");
  if (!v.artifactsOk) issues.push("ARTIFACTS");
  if (!v.impliedReliabilityOk) issues.push("IMPLIED_RELIABILITY");
  if (v.forbiddenHits?.length)
    issues.push(`FORBIDDEN: ${v.forbiddenHits.join(", ")}`);
  return issues.length
    ? `Violations: ${issues.join("; ")}`
    : "All constraints satisfied.";
}

// --- OpenAI helper -----------------------------------------------------------

async function callOpenAIChat({
  system,
  user,
  temperature = 0.4,
  response_format,
}) {
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

// --- Rules parser ------------------------------------------------------------

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
