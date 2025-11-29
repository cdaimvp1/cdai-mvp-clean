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
const DEMO_PASSWORD = process.env.SESSION_PASSWORD;
if (!DEMO_PASSWORD) {
  console.error("SESSION_PASSWORD missing from environment");
  process.exit(1);
}


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

// Wait for user clarification (MCP ↔ user loop)
function waitForUserClarification(socket, { cycle }) {
  return new Promise((resolve) => {
    let settled = false;
    const timeoutMs = 120000; // 2 minutes

    function cleanup() {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      socket.off("clarification-response", onResponse);
    }

    function onResponse(payload) {
      if (!payload) return;

      // Simple match-by-cycle to avoid collisions
      if (
        typeof payload.cycle === "number" &&
        typeof cycle === "number" &&
        payload.cycle !== cycle
      ) {
        return;
      }

      cleanup();
      const answer =
        typeof payload.answer === "string" ? payload.answer.trim() : "";
      resolve(answer || null);
    }

    const timeoutId = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);

    socket.on("clarification-response", onResponse);
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
- Infer the most natural output format from the task (e.g., email, memo, bullets),
  and preserve that structure (greetings, subject lines, paragraphs, bullets)
  unless governance rules explicitly require a different structure.
- Do not over-optimize for governance; this is a baseline for refinement by
  the Analytical and Creative hemispheres.
- Keep the style business-formal and concise by default.
    `,
    user: `
User task:
${input}

High-level governance hints (do NOT treat as exact instructions):
${rules.map((r, i) => `${i + 1}. ${r}`).join("\n") || "None provided."}

If the user task clearly implies a format (e.g., "draft an email", "create 4 bullet points"),
honor that format in your draft, as long as it does not directly conflict with the governance hints.
    `,
    temperature: 0.5,
  });

  let currentText = taskDraft || `Initial draft based on: "${input}"`;

  ledger.push({
    timestamp: new Date().toISOString(),
    stage: "TaskAgent",
    cycle: 0,
    summary: "Initial draft generated by Task Agent (format inferred from task).",
    snippet: currentText.slice(0, 260),
  });

  socket.emit("telemetry", {
    type: "hemisphere-log",
    hemisphere: "A",
    message: "Task Agent produced the first draft.",
  });

  let validation = initialValidationState();
  let converged = false;
  let clarificationCount = 0;

  // --- Dual-Hemisphere Cycles ------------------------------------------------

  for (let cycle = 1; cycle <= effectiveMaxCycles; cycle++) {
    socket.emit("telemetry", { type: "cycle-update", cycle });
    socket.emit("telemetry", {
      type: "governance-rules-progress",
      cycle,
    });

    // ---- Analytical
    socket.emit("telemetry", {
      type: "mcp-status",
      status: "Analytical Pass",
      detail: `Cycle ${cycle}: analytical hemisphere enforcing governance constraints.`,
    });

    const analyticalResult = await analyticalPass(currentText, {
      input,
      rules,
      governanceStrictness: effectiveStrictness,
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

    // ---- Moderator (mediator between A and B)
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
      validation,
    });

    ledger.push({
      timestamp: new Date().toISOString(),
      stage: "Moderator",
      cycle,
      summary: moderatorResult.moderatorSummary,
      snippet: currentText.slice(0, 260),
    });

    socket.emit("telemetry", {
      type: "moderator-log",
      message: `Cycle ${cycle}: ${moderatorResult.moderatorSummary} ${
        typeof moderatorResult.confidence === "number"
          ? `(confidence ${moderatorResult.confidence.toFixed(2)})`
          : ""
      }`.trim(),
    });

    // --- Optional MCP ↔ user clarification loop -----------------------------
    let userFeedback = null;

    if (
      moderatorResult.needsUserClarification &&
      clarificationCount < 2 && // guardrail: at most 2 questions per run
      perfMode !== "turbo"
    ) {
      clarificationCount += 1;

      const question =
        moderatorResult.userQuestion ||
        "The MCP needs a brief clarification to choose between competing interpretations of your request. Please restate what you want in 1–2 sentences.";

      socket.emit("telemetry", {
        type: "clarification-request",
        question,
        confidence: moderatorResult.confidence ?? null,
        cycle,
      });

      ledger.push({
        timestamp: new Date().toISOString(),
        stage: "ClarificationRequest",
        cycle,
        summary: `Moderator requested user clarification: "${question.slice(
          0,
          200
        )}"`,
        snippet: currentText.slice(0, 200),
      });

      userFeedback = await waitForUserClarification(socket, { cycle });

      if (userFeedback) {
        ledger.push({
          timestamp: new Date().toISOString(),
          stage: "UserFeedback",
          cycle,
          summary: `User clarification received and will be incorporated into this cycle.`,
          snippet: userFeedback.slice(0, 200),
        });

        socket.emit("telemetry", {
          type: "moderator-log",
          message: `Cycle ${cycle}: user clarification received and injected into the MCP prompt.`,
        });
      } else {
        ledger.push({
          timestamp: new Date().toISOString(),
          stage: "ClarificationTimeout",
          cycle,
          summary:
            "No user clarification received within the time window; MCP continued using existing assumptions.",
          snippet: currentText.slice(0, 200),
        });

        socket.emit("telemetry", {
          type: "moderator-log",
          message: `Cycle ${cycle}: no user clarification received in time; continued with existing interpretation.`,
        });
      }
    }

    // ---- Creative
    socket.emit("telemetry", {
      type: "mcp-status",
      status: "Creative Pass",
      detail:
        "Creative hemisphere refining tone and readability within moderated constraints.",
    });

    const creativeResult = await creativePass(currentText, {
      input,
      rules,
      governanceStrictness: effectiveStrictness,
      moderatedPrompt: moderatorResult.moderatedPrompt,
      userFeedback,
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
      governanceStrictness: effectiveStrictness,
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

TURBO MODE:
- Generate a concise business-formal draft,
- Respect the governance rules as much as reasonably possible,
- Preserve natural formatting inferred from the task (subject lines, greetings, bullets),
- But prioritize speed over exhaustive enforcement or convergence.

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
  socket.emit("telemetry", {
    type: "moderator-log",
    message:
      "Turbo mode: moderator behavior simulated for demo; no user clarifications requested in this mode.",
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
  { input, rules, governanceStrictness }
) {
  const system = `
You are the ANALYTICAL hemisphere in the cd\\ai governed architecture.

Your responsibilities:
- Enforce governance constraints strictly,
- Make minimal necessary edits to the draft,
- Preserve the user's inferred structure and format whenever possible
  (e.g., if it already looks like an email, keep greetings, subject line, closing),
- Report clearly what changed and why.

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

  const user = `
Task:
${input}

Governance rules (treat as hard constraints):
${rules.join("\n")}

Current draft (preserve its overall format if possible):
${currentText}

Strictness coefficient: ${governanceStrictness.toFixed(2)}

Be conservative: when unsure, prefer to tighten language rather than relax it.
Do NOT flatten formatting unless the rules clearly require a structural change.
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
  { input, rules, governanceStrictness, analyticalSummary, directives, validation }
) {
  const system = `
You are the MODERATOR between the Analytical and Creative hemispheres in cd\\ai.

Your role:
- Rewrite the prompt that will be given to the Creative hemisphere,
- So that the Creative hemisphere expands and polishes the text WITHOUT reintroducing governance violations,
- Preserve the existing inferred output format (email, memo, bullets, etc.) unless rules require otherwise,
- Decide whether user clarification is needed when confidence is low or the rules/inputs are ambiguous.

Return JSON ONLY with:
{
  "moderatedPrompt": "prompt text the Creative hemisphere should follow",
  "moderatorSummary": "1–2 sentence summary of how you constrained the Creative behavior",
  "confidence": 0.0-1.0,
  "needsUserClarification": true/false,
  "userQuestion": "short, plain-language question to ask the user when clarification is needed, or null if not needed"
}
  `;

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

Validator state:
${JSON.stringify(validation || {}, null, 2)}

Strictness coefficient: ${governanceStrictness.toFixed(2)}

Guidance:
- If you are reasonably confident (e.g., confidence >= 0.7) that you understand
  the user's intent and the governance rules are unambiguous, set
  "needsUserClarification": false.
- If you are unsure between two or more interpretations of what the user wants
  or how to satisfy the rules, set "needsUserClarification": true and craft
  a single clear question that a senior business stakeholder could answer in
  1–2 sentences.
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
      confidence: 0.6,
      needsUserClarification: false,
      userQuestion: null,
    };
  }

  return {
    moderatedPrompt:
      parsed.moderatedPrompt ||
      "You are the Creative hemisphere. Improve readability and flow without relaxing any governance constraints or reintroducing forbidden terms.",
    moderatorSummary:
      parsed.moderatorSummary ||
      "Moderator constrained Creative behavior to focus on clarity and tone without weakening governance alignment.",
    confidence:
      typeof parsed.confidence === "number" ? parsed.confidence : 0.7,
    needsUserClarification: !!parsed.needsUserClarification,
    userQuestion: parsed.userQuestion || null,
  };
}

async function creativePass(
  currentText,
  { input, rules, governanceStrictness, moderatedPrompt, userFeedback }
) {
  const system = `
You are the CREATIVE hemisphere in the cd\\ai architecture.
You MUST obey the moderatedPrompt you receive.

Your job:
- Improve clarity, narrative flow, and executive readability,
- Preserve the existing inferred format (email, memo, bullets, etc.) unless
  moderatedPrompt explicitly instructs otherwise,
- Do NOT reintroduce any governance violations or forbidden language,
- Keep the length reasonably close unless moderatedPrompt explicitly says otherwise.

Return JSON ONLY with:
{
  "rewrittenText": "string",
  "deltaSummary": "1–2 sentence summary of how you improved tone/readability this cycle"
}
  `;

  const user = `
moderatedPrompt (FOLLOW THIS CAREFULLY):
${moderatedPrompt}

User task:
${input}

Governance rules (must remain satisfied):
${rules.join("\n")}

Current draft to refine (preserve structure unless instructed otherwise):
${currentText}

User clarification (if any; treat as authoritative when present):
${userFeedback || "None provided."}

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
      "Creative hemisphere refined clarity, flow, and tone while respecting governance constraints.",
  };
}

async function validatorPass(text, { input, rules, governanceStrictness }) {
  const system = `
You are the Validator in the cd\\ai governed architecture.

Your job:
- Check the draft against the governance rules,
- Identify violations clearly,
- Return a compact JSON verdict.

Return JSON ONLY with:
{
  "forbiddenHits": ["string"],   // any forbidden words or concepts actually present
  "wordCountOk": true/false,
  "artifactsOk": true/false,     // whether the requested artifacts / structural elements are satisfied
  "impliedReliabilityOk": true/false
}
  `;

  const user = `
User task:
${input}

Governance rules:
${rules.join("\n")}

Draft to validate:
${text}

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
