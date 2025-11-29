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

// CORS-like basic header
app.use((req, res, next) => {
  res.setHeader("X-Powered-By", "cd/ai mvp");
  next();
});

// --- Enable iframe embedding (WordPress, etc.) -------------------------------

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

  // Per-socket clarification resolver
  socket.currentClarificationResolver = null;

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

  // User clarification coming back from the UI (chat panel / reply box)
  socket.on("user-clarification", ({ answer }) => {
    const trimmed = (answer || "").toString().trim();
    if (socket.currentClarificationResolver) {
      socket.currentClarificationResolver(trimmed || null);
      socket.currentClarificationResolver = null;
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    // If they disconnect while we were waiting for feedback, release the waiter
    if (socket.currentClarificationResolver) {
      socket.currentClarificationResolver(null);
      socket.currentClarificationResolver = null;
    }
  });
});

// --- Helpers -----------------------------------------------------------------

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

function initialValidationState() {
  return {
    forbiddenHits: [],
    wordCountOk: true,
    artifactsOk: true,
    impliedReliabilityOk: true,
    isCompliant: false,
  };
}

// Wait for user clarification through Socket.IO with timeout
function waitForUserClarification(socket, { cycle, question, confidence }) {
  return new Promise((resolve) => {
    let finished = false;

    const timeoutMs = 5 * 60 * 1000; // 5 minutes safety timeout
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      socket.currentClarificationResolver = null;
      resolve(null);
    }, timeoutMs);

    socket.currentClarificationResolver = (answer) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(answer);
    };

    // Emit a telemetry packet for the UI to show in the chat panel
    socket.emit("telemetry", {
      type: "user-question",
      cycle,
      question,
      confidence,
    });
  });
}

// --- Core Governed Workflow --------------------------------------------------

async function runGovernedWorkflow(
  socket,
  { input, goal, maxCycles, governanceStrictness, perfMode }
) {
  socket.emit("telemetry", { type: "reset" });

  const rules = parseRulesFromGoal(goal);
  const ledger = [];
  const userClarifications = [];

  // Mode-specific tuning
  let effectiveMaxCycles = maxCycles || 5;
  let effectiveStrictness = governanceStrictness || 0.85;
  let minCycles = 1;

  if (perfMode === "real") {
    // Full convergence behavior: require at least 2 passes to show cycling.
    minCycles = Math.min(2, effectiveMaxCycles);
  } else if (perfMode === "fast") {
    // Still governed, but fewer passes.
    effectiveMaxCycles = Math.min(3, effectiveMaxCycles);
    minCycles = 1;
  } else if (perfMode === "turbo") {
    // Turbo gets its own ultra-fast path.
    return runTurboWorkflow(socket, {
      input,
      goal,
      rules,
      governanceStrictness: effectiveStrictness,
      ledger,
    });
  }

  // Plan cycles for animation (frontend)
  socket.emit("telemetry", {
    type: "cycle-plan",
    plannedCycles: effectiveMaxCycles,
  });

  socket.emit("telemetry", {
    type: "governance-rules",
    rules,
  });

  socket.emit("telemetry", {
    type: "mcp-status",
    status: "Starting",
    detail: `Initializing governed workflow in ${perfMode.toUpperCase()} mode…`,
  });

  // --- Task Agent initial draft ---------------------------------------------

  const taskDraft = await callOpenAIChat({
    system: `
You are the Task Agent in a governed dual-hemisphere AI system (cd\\ai).

Your responsibilities:
- Produce an initial neutral draft based on the user task.
- Preserve any obvious structural signals from the user input (e.g., "Subject:", bullet lists, or email signatures),
  unless the governance rules explicitly require a different format.
- Write in clear, business-formal language suitable for senior readers.
- Do NOT over-optimize for governance; this is a baseline to be refined.
    `,
    user: `
User task (may implicitly signal desired format such as email, memo, or short answer):
${input}

High-level governance hints (do NOT treat as exact instructions):
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
    message: "Task Agent produced the first draft.",
  });

  let validation = initialValidationState();
  let converged = false;

  // --- Dual-Hemisphere Cycles ------------------------------------------------

  for (let cycle = 1; cycle <= effectiveMaxCycles; cycle++) {
    socket.emit("telemetry", { type: "cycle-update", cycle });
    socket.emit("telemetry", {
      type: "governance-rules-progress",
      cycle,
    });

    // ---- Analytical Hemisphere ---------------------------------------------
    socket.emit("telemetry", {
      type: "mcp-status",
      status: "Analytical Pass",
      detail: `Cycle ${cycle}: analytical hemisphere enforcing governance constraints.`,
    });

    const analyticalResult = await analyticalPass(currentText, {
      input,
      rules,
      governanceStrictness: effectiveStrictness,
      userClarifications,
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

    // ---- Moderator Hemisphere ----------------------------------------------
    socket.emit("telemetry", {
      type: "mcp-status",
      status: "Moderator",
      detail: `Cycle ${cycle}: moderator tightening the creative prompt to prevent reintroducing violations.`,
    });

    const moderatorResult = await moderatorPass(currentText, {
      input,
      rules,
      governanceStrictness: effectiveStrictness,
      analyticalSummary: analyticalResult.deltaSummary,
      directives: analyticalResult.directives,
      userClarifications,
    });

    ledger.push({
      timestamp: new Date().toISOString(),
      stage: "Moderator",
      cycle,
      summary: moderatorResult.moderatorSummary,
      snippet: currentText.slice(0, 260),
    });

    // Optional user clarification loop
    if (
      moderatorResult.askUser &&
      moderatorResult.userQuestion &&
      typeof moderatorResult.confidence === "number"
    ) {
      const confidencePct = Math.round(moderatorResult.confidence * 100);
      ledger.push({
        timestamp: new Date().toISOString(),
        stage: "Moderator",
        cycle,
        summary: `Moderator requested user clarification (confidence ${confidencePct}%). Question: ${moderatorResult.userQuestion}`,
        snippet: currentText.slice(0, 260),
      });

      // Ask user via chat / clarification UI
      const userAnswer = await waitForUserClarification(socket, {
        cycle,
        question: moderatorResult.userQuestion,
        confidence: moderatorResult.confidence,
      });

      if (userAnswer) {
        userClarifications.push({
          cycle,
          question: moderatorResult.userQuestion,
          answer: userAnswer,
        });

        ledger.push({
          timestamp: new Date().toISOString(),
          stage: "UserInput",
          cycle,
          summary: `User provided clarification: "${userAnswer.slice(0, 200)}"${
            userAnswer.length > 200 ? "..." : ""
          }`,
          snippet: currentText.slice(0, 260),
        });
      } else {
        ledger.push({
          timestamp: new Date().toISOString(),
          stage: "UserInput",
          cycle,
          summary:
            "No user clarification received within the allotted time; continuing with existing constraints.",
          snippet: currentText.slice(0, 260),
        });
      }
    }

    // ---- Creative Hemisphere -----------------------------------------------
    socket.emit("telemetry", {
      type: "mcp-status",
      status: "Creative Pass",
      detail: `Cycle ${cycle}: creative hemisphere refining tone and readability within moderated constraints.`,
    });

    const creativeResult = await creativePass(currentText, {
      input,
      rules,
      governanceStrictness: effectiveStrictness,
      moderatedPrompt: moderatorResult.moderatedPrompt,
      userClarifications,
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

    // ---- Validator ---------------------------------------------------------
    const postCreativeValidation = await validatorPass(currentText, {
      input,
      rules,
      governanceStrictness: effectiveStrictness,
      userClarifications,
    });

    validation = postCreativeValidation;

    ledger.push({
      timestamp: new Date().toISOString(),
      stage: "Validator",
      cycle,
      summary: validationSummary(validation),
      snippet: currentText.slice(0, 260),
    });

    if (validation.isCompliant && cycle >= minCycles) {
      converged = true;
      break;
    }
  }

  socket.emit("telemetry", { type: "governance-rules-final" });
  socket.emit("telemetry", {
    type: "mcp-status",
    status: "Finalized",
    detail: converged
      ? "Governed output locked after dual-hemisphere convergence."
      : "Locked after max cycles (fail-safe stop).",
  });

  socket.emit("telemetry", { type: "ledger", entries: ledger });
  socket.emit("telemetry", { type: "final-output", text: currentText });
}

// --- Turbo Workflow (ultra-fast) --------------------------------------------

async function runTurboWorkflow(
  socket,
  { input, goal, rules, governanceStrictness, ledger }
) {
  socket.emit("telemetry", {
    type: "cycle-plan",
    plannedCycles: 2, // animation: quick A→B→Final
  });

  socket.emit("telemetry", {
    type: "governance-rules",
    rules,
  });

  socket.emit("telemetry", {
    type: "mcp-status",
    status: "Starting",
    detail:
      "Turbo mode: single governed pass with approximate validation for demonstration speed.",
  });

  // Single combined pass: Task + Analytical + Creative in one shot.
  const combined = await callOpenAIChat({
    system: `
You are a combined Task + Analytical + Creative agent in the cd\\ai architecture.

In TURBO MODE you must:
- Generate a concise draft in clear business-formal language,
- Respect the governance rules as much as feasible in a single pass,
- Preserve obvious structural cues (e.g., email-like subject lines) unless rules forbid them,
- Prioritize speed over exhaustive enforcement.

Return ONLY the final draft text. Do NOT explain your reasoning.
    `,
    user: `
User task:
${input}

Governance rules (high level – do your best within a single pass):
${rules.join("\n") || "None provided."}
    `,
    temperature: 0.5,
  });

  const text = combined || `Draft (turbo mode) based on: "${input}"`;

  const now = new Date().toISOString();
  ledger.push({
    timestamp: now,
    stage: "Turbo",
    cycle: 1,
    summary:
      "Turbo mode executed a single combined governed pass (Task + Analytical + Creative). Validation is approximate only.",
    snippet: text.slice(0, 260),
  });

  socket.emit("telemetry", {
    type: "hemisphere-log",
    hemisphere: "A",
    message:
      "Turbo mode: analytical behavior approximated in a single combined pass.",
  });
  socket.emit("telemetry", {
    type: "hemisphere-log",
    hemisphere: "B",
    message:
      "Turbo mode: creative polish applied once under approximate constraints.",
  });

  socket.emit("telemetry", { type: "governance-rules-final" });
  socket.emit("telemetry", {
    type: "mcp-status",
    status: "Finalized",
    detail:
      "Turbo mode completed: governed behavior approximated in a single pass for speed.",
  });

  socket.emit("telemetry", { type: "ledger", entries: ledger });
  socket.emit("telemetry", { type: "final-output", text });
}

// --- Analytical, Moderator, Creative, Validator Passes ----------------------

async function analyticalPass(
  currentText,
  { input, rules, governanceStrictness, userClarifications }
) {
  const system = `
You are the ANALYTICAL hemisphere in the cd\\ai governed architecture.

Your responsibilities:
- Enforce governance constraints strictly.
- Make the minimal necessary edits to the draft.
- Clearly explain what changed and why in this cycle.
- Prefer tightening language over relaxing constraints when in doubt.

Return JSON ONLY with the following structure:
{
  "rewrittenText": "string",
  "directives": [
    {
      "area": "length | forbidden_terms | structure | tone | artifacts | reliability_language | other",
      "strength": 0.0-1.0,
      "instruction": "short plain-language directive"
    }
  ],
  "validation": {
    "forbiddenHits": ["word1", "word2"],
    "wordCountOk": true/false,
    "artifactsOk": true/false,
    "impliedReliabilityOk": true/false
  },
  "deltaSummary": "1–2 sentence explanation of what you changed THIS CYCLE in clear business language."
}
  `;

  const clarificationsText =
    userClarifications && userClarifications.length
      ? userClarifications
          .map(
            (c) =>
              `Cycle ${c.cycle} – Q: ${c.question}\nA: ${c.answer}\n`
          )
          .join("\n")
      : "None.";

  const user = `
User task:
${input}

Governance rules (treat as hard constraints):
${rules.join("\n")}

Current draft:
${currentText}

Additional user clarifications so far (treat as authoritative when not conflicting with rules):
${clarificationsText}

Strictness coefficient: ${governanceStrictness.toFixed(2)}
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
      deltaSummary:
        "Analytical hemisphere encountered a parsing issue and preserved the previous draft.",
    };
  }

  const validation = {
    ...initialValidationState(),
    ...(parsed.validation || {}),
  };

  return {
    rewrittenText: parsed.rewrittenText || currentText,
    directives: Array.isArray(parsed.directives) ? parsed.directives : [],
    validation,
    deltaSummary:
      parsed.deltaSummary ||
      "Analytical hemisphere updated structure and governance alignment.",
  };
}

async function moderatorPass(
  currentText,
  {
    input,
    rules,
    governanceStrictness,
    analyticalSummary,
    directives,
    userClarifications,
  }
) {
  const system = `
You are the MODERATOR between the Analytical and Creative hemispheres in cd\\ai.

Your responsibilities:
- Rewrite the prompt that will be given to the Creative hemisphere.
- Ensure the Creative hemisphere expands and polishes the text WITHOUT:
  - reintroducing governance violations,
  - undoing analytical safeguards,
  - ignoring user clarifications.
- You do NOT edit the draft directly; you only produce a better prompt for the Creative hemisphere.
- You also estimate whether more guidance from the human user is needed.

Return JSON ONLY with:
{
  "moderatedPrompt": "prompt text the Creative hemisphere should follow",
  "moderatorSummary": "1–2 sentence summary of how you constrained the Creative behavior",
  "askUser": true/false,
  "userQuestion": "null or short, clear question for the user in business language",
  "confidence": 0.0-1.0
}
  `;

  const clarificationsText =
    userClarifications && userClarifications.length
      ? userClarifications
          .map(
            (c) =>
              `Cycle ${c.cycle} – Q: ${c.question}\nA: ${c.answer}\n`
          )
          .join("\n")
      : "None so far.";

  const user = `
User task:
${input}

Governance rules:
${rules.join("\n")}

Current draft:
${currentText}

Analytical summary this cycle:
${analyticalSummary}

Analytical directives:
${JSON.stringify(directives || [], null, 2)}

User clarifications received so far (highly relevant for removing ambiguity):
${clarificationsText}

Strictness coefficient: ${governanceStrictness.toFixed(2)}

If you are not confident the Creative hemisphere can safely act without more human guidance,
set "askUser": true and provide ONE short, concrete question in "userQuestion".
  `;

  const raw = await callOpenAIChat({
    system,
    user,
    temperature: 0.25,
    response_format: "json",
  });

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      moderatedPrompt:
        "You are the Creative hemisphere. Improve readability and flow without relaxing any governance constraints or reintroducing forbidden terms. Keep the length and structure close to the current draft.",
      moderatorSummary:
        "Moderator fallback: used a default conservative prompt to keep Creative changes bounded.",
      askUser: false,
      userQuestion: null,
      confidence: 0.7,
    };
  }

  return {
    moderatedPrompt:
      parsed.moderatedPrompt ||
      "You are the Creative hemisphere. Improve readability and flow without relaxing any governance constraints or reintroducing forbidden terms.",
    moderatorSummary:
      parsed.moderatorSummary ||
      "Moderator constrained Creative behavior to focus on clarity and tone without weakening governance alignment.",
    askUser: Boolean(parsed.askUser),
    userQuestion: parsed.userQuestion || null,
    confidence:
      typeof parsed.confidence === "number"
        ? Math.min(1, Math.max(0, parsed.confidence))
        : 0.75,
  };
}

async function creativePass(
  currentText,
  { input, rules, governanceStrictness, moderatedPrompt, userClarifications }
) {
  const system = `
You are the CREATIVE hemisphere in the cd\\ai architecture.

You MUST obey the moderatedPrompt you receive.

Your responsibilities:
- Improve clarity, narrative flow, and executive readability.
- Preserve or enhance any structural cues (email header, paragraphs, lists) that serve the task,
  unless the governance rules explicitly require a different format.
- Do NOT break governance rules or reintroduce forbidden patterns.
- Keep the length reasonably close unless the moderatedPrompt explicitly says otherwise.

Return JSON ONLY with:
{
  "rewrittenText": "string",
  "deltaSummary": "1–2 sentence summary of how you improved tone/readability this cycle"
}
  `;

  const clarificationsText =
    userClarifications && userClarifications.length
      ? userClarifications
          .map(
            (c) =>
              `Cycle ${c.cycle} – Q: ${c.question}\nA: ${c.answer}\n`
          )
          .join("\n")
      : "None.";

  const user = `
moderatedPrompt (FOLLOW THIS CAREFULLY):
${moderatedPrompt}

User task:
${input}

Governance rules (must remain satisfied):
${rules.join("\n")}

Current draft to refine:
${currentText}

Additional user clarifications to respect:
${clarificationsText}

Strictness coefficient: ${governanceStrictness.toFixed(2)}
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
      deltaSummary:
        "Creative hemisphere encountered a parsing issue and preserved the prior draft.",
    };
  }

  return {
    rewrittenText: parsed.rewrittenText || currentText,
    deltaSummary:
      parsed.deltaSummary ||
      "Creative hemisphere refined clarity, flow, and tone while respecting governance constraints and preserving reasonable structure.",
  };
}

async function validatorPass(
  text,
  { input, rules, governanceStrictness, userClarifications }
) {
  const system = `
You are the Validator in the cd\\ai governed architecture.

Your responsibilities:
- Check the draft against the governance rules.
- Identify any violations clearly and compactly.
- Take into account user clarifications where they help resolve ambiguity,
  but NEVER let them override hard governance constraints.

Return JSON ONLY with:
{
  "forbiddenHits": ["string"],   // any forbidden words or concepts actually present
  "wordCountOk": true/false,
  "artifactsOk": true/false,     // whether the requested artifacts / structural elements are satisfied
  "impliedReliabilityOk": true/false
}
  `;

  const clarificationsText =
    userClarifications && userClarifications.length
      ? userClarifications
          .map(
            (c) =>
              `Cycle ${c.cycle} – Q: ${c.question}\nA: ${c.answer}\n`
          )
          .join("\n")
      : "None.";

  const user = `
User task:
${input}

Governance rules:
${rules.join("\n")}

Draft to validate:
${text}

User clarifications:
${clarificationsText}

Strictness coefficient: ${governanceStrictness.toFixed(2)}
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
  if (v.forbiddenHits?.length)
    issues.push(`FORBIDDEN: ${v.forbiddenHits.join(", ")}`);
  return issues.length
    ? `Violations: ${issues.join("; ")}`
    : "All constraints satisfied.";
}

// --- OpenAI Helper -----------------------------------------------------------

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
