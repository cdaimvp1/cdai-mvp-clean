/* ============================================================================
   cd\ai Governed MVP – Frontend Logic
   ========================================================================= */

/* globals io */

const socket = io();

/* ---- DOM references ------------------------------------------------------ */

// Header
const statusLabelDynamicEl = document.getElementById("status-label-dynamic");
const strictnessSliderEl = document.getElementById("strictness-slider");
const cycleSliderEl = document.getElementById("cycle-slider");
const modePills = document.querySelectorAll(".mode-pill");
const logoutButtonEl = document.getElementById("logout-button");

// Layout / status
const runStatusEl = document.getElementById("run-status");

// Left column – Governance Conversation
const chatHistoryEl = document.getElementById("chat-history");
const chatInputEl = document.getElementById("chat-input");
const chatSendButtonEl = document.getElementById("chat-send-button");
const chatResetButtonEl = document.getElementById("chat-reset-button");

// Left column – Goal / Governance submission
const goalInputEl = document.getElementById("goal-input");
const goalResetButtonEl = document.getElementById("goal-reset-button");
const goalSubmitButtonEl = document.getElementById("goal-submit-button");

// Left column – Parsed governance rules display
const rulesListEl = document.getElementById("rules-list");

// Right column – MCP & Cycle
const cycleIndicatorEl = document.getElementById("cycle-indicator");
const mcpDetailEl = document.getElementById("mcp-detail");

// Right column – Logs
const analyticalLogEl = document.getElementById("analytical-log");
const moderatorLogEl = document.getElementById("moderator-log");
const creativeLogEl = document.getElementById("creative-log");
const ledgerLogEl = document.getElementById("ledger-log");
const downloadLedgerBtn = document.getElementById("download-ledger-btn");
const logPanels = document.querySelectorAll(".log-panel");
const chevronButtons = document.querySelectorAll(".chevron-btn");

/* ---- State ---------------------------------------------------------------- */

let governanceLocked = false;
let currentGoalText = "";
let workflowRunning = false;

let currentPerfMode = "real";
let plannedCycles = 0;

let awaitingClarification = false;
let activeClarificationCycle = null;

let currentLedger = [];
let ruleState = [];

/* ============================================================================
   Helpers – formatting, status, utilities
   ========================================================================== */

function nowStamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

function escapeHtml(text) {
  if (text === null || text === undefined) return "";
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return String(text).replace(/[&<>"']/g, (c) => map[c] || c);
}

/* ---- Header status -------------------------------------------------------- */

function setStatus(statusKey) {
  if (!statusLabelDynamicEl) return;

  let labelText = "Idle";
  let cls = "status-label-dynamic status-idle";

  switch (statusKey) {
    case "analytical":
      labelText = "Analytical";
      cls = "status-label-dynamic status-analytical";
      break;
    case "moderator":
      labelText = "Moderator";
      cls = "status-label-dynamic status-moderator";
      break;
    case "creative":
      labelText = "Creative";
      cls = "status-label-dynamic status-creative";
      break;
    case "validator":
      labelText = "Validator";
      cls = "status-label-dynamic status-validator";
      break;
    case "user":
      labelText = "User";
      cls = "status-label-dynamic status-user";
      break;
    case "final":
      labelText = "Final";
      cls = "status-label-dynamic status-final";
      break;
    case "error":
      labelText = "Error";
      cls = "status-label-dynamic status-error";
      break;
    case "idle":
    default:
      labelText = "Idle";
      cls = "status-label-dynamic status-idle";
      break;
  }

  statusLabelDynamicEl.textContent = labelText;
  statusLabelDynamicEl.className = cls;
}

/* ---- Sliders & perf mode -------------------------------------------------- */

function getGovernanceStrictness() {
  if (!strictnessSliderEl) return 0.85;
  const v = Number(strictnessSliderEl.value);
  return Number.isFinite(v) ? v : 0.85;
}

function getMaxCycles() {
  if (!cycleSliderEl) return 5;
  const v = parseInt(cycleSliderEl.value, 10);
  if (!Number.isFinite(v)) return 5;
  return Math.min(10, Math.max(1, v));
}

function getPerfMode() {
  return currentPerfMode || "real";
}

function initPerfModeControls() {
  modePills.forEach((pill) => {
    pill.addEventListener("click", () => {
      if (workflowRunning) return; // avoid mode flip mid-run in demo
      const mode = pill.dataset.mode || "real";
      currentPerfMode = mode;

      modePills.forEach((p) => {
        p.classList.toggle("active", p === pill);
      });
    });
  });
}

/* ============================================================================
   Chat rendering
   ========================================================================== */

function appendChatMessage(kind, text, meta) {
  if (!chatHistoryEl) return;
  const message = text || "";
  const stamp = (meta && meta.timestamp) || nowStamp();

  const row = document.createElement("div");
  row.className = "chat-message-row";

  const bubble = document.createElement("div");
  bubble.className = "chat-message";

  if (kind === "user") {
    row.classList.add("user");
    bubble.classList.add("user");
  } else if (kind === "system-final") {
    row.classList.add("system");
    bubble.classList.add("final");
  } else {
    row.classList.add("system");
    bubble.classList.add("system");
  }

  const body = document.createElement("div");
  body.className = "message-text";
  body.innerText = message;

  const metaDiv = document.createElement("div");
  metaDiv.className = "message-meta";
  metaDiv.textContent = stamp;

  bubble.appendChild(body);
  bubble.appendChild(metaDiv);
  row.appendChild(bubble);

  chatHistoryEl.appendChild(row);
  chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
}

function clearChatHistory() {
  if (!chatHistoryEl) return;
  chatHistoryEl.innerHTML = "";
}

/* ============================================================================
   Governance rules list handling
   ========================================================================== */

function initGovernanceRules(rules) {
  if (!rulesListEl) return;

  rulesListEl.innerHTML = "";
  ruleState = (rules || []).map((r) => ({
    text: r,
    status: "pending",
  }));

  ruleState.forEach((rule, idx) => {
    const li = document.createElement("li");
    li.dataset.index = String(idx);

    const dot = document.createElement("span");
    dot.className = "rule-status-dot pending";

    const textSpan = document.createElement("span");
    textSpan.className = "rule-text";
    textSpan.textContent = rule.text;

    li.appendChild(dot);
    li.appendChild(textSpan);
    rulesListEl.appendChild(li);
  });
}

function markRulesProgress() {
  if (!rulesListEl) return;

  ruleState.forEach((rule, index) => {
    const li = rulesListEl.querySelector(`li[data-index="${index}"]`);
    if (!li) return;
    const dot = li.querySelector(".rule-status-dot");
    if (!dot) return;

    if (rule.status === "pending") {
      rule.status = "in-progress";
      dot.className = "rule-status-dot in-progress";
    } else if (rule.status === "in-progress") {
      rule.status = "passed";
      dot.className = "rule-status-dot passed";
    }
  });
}

function markRulesFinal() {
  if (!rulesListEl) return;

  ruleState.forEach((rule, index) => {
    rule.status = "passed";
    const li = rulesListEl.querySelector(`li[data-index="${index}"]`);
    if (!li) return;
    const dot = li.querySelector(".rule-status-dot");
    if (!dot) return;
    dot.className = "rule-status-dot passed";
  });
}

/* ============================================================================
   Logs & ledger
   ========================================================================== */

function appendLogEntry(containerEl, kindClass, message) {
  if (!containerEl) return;
  const div = document.createElement("div");
  div.className = `log-entry ${kindClass}`;
  div.innerHTML = `<span class="timestamp">${escapeHtml(
    nowStamp()
  )}</span>${escapeHtml(message)}`;
  containerEl.appendChild(div);
  containerEl.scrollTop = containerEl.scrollHeight;
}

function updateLedger(entries) {
  currentLedger = entries.slice();
  if (!ledgerLogEl) return;

  ledgerLogEl.innerHTML = "";

  currentLedger.forEach((e) => {
    const div = document.createElement("div");
    div.className = "log-entry ledger";
    const ts = escapeHtml(e.timestamp || "");
    const stage = escapeHtml(e.stage || "");
    const cyc =
      typeof e.cycle === "number" ? `cycle ${e.cycle}` : "cycle –";
    const summary = escapeHtml(e.summary || "");
    div.innerHTML = `<span class="timestamp">${ts}</span>[${stage} – ${cyc}] ${summary}`;
    ledgerLogEl.appendChild(div);
  });

  ledgerLogEl.scrollTop = ledgerLogEl.scrollHeight;
}

function initLogCollapsibles() {
  chevronButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const panel = btn.closest(".log-panel");
      if (!panel) return;
      panel.classList.toggle("collapsed");
    });
  });
}

/* ---- Ledger download ------------------------------------------------------ */

if (downloadLedgerBtn) {
  downloadLedgerBtn.addEventListener("click", () => {
    if (!currentLedger || currentLedger.length === 0) {
      alert("No ledger entries available yet.");
      return;
    }

    const blob = new Blob([JSON.stringify(currentLedger, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cdai_immutable_ledger_${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}

/* ============================================================================
   Governance submission & reset
   ========================================================================== */

function parseRulesLocal(goalText) {
  if (!goalText) return [];
  const pieces = goalText
    .split(/\n|;/)
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  return pieces.length ? pieces : [goalText.trim()];
}

function handleSubmitGovernance() {
  if (workflowRunning) {
    appendChatMessage(
      "system",
      "A governed workflow is currently running. Please wait until it completes before changing governance rules."
    );
    return;
  }

  const text = (goalInputEl?.value || "").trim();
  if (!text) {
    appendChatMessage(
      "system",
      "Please enter governance rules or a goal before submitting."
    );
    return;
  }

  currentGoalText = text;
  governanceLocked = true;

  const rules = parseRulesLocal(text);
  initGovernanceRules(rules);

  if (runStatusEl) {
    runStatusEl.textContent =
      "Governance rules submitted. You may now send tasks in the conversation.";
  }

  appendChatMessage(
    "system",
    "Governance rules have been submitted and locked for this demo. You can still reset and resubmit before running a new task."
  );
}

function handleResetGovernance() {
  if (workflowRunning) {
    appendChatMessage(
      "system",
      "Cannot reset governance while a governed workflow is running."
    );
    return;
  }

  if (goalInputEl) goalInputEl.value = "";
  currentGoalText = "";
  governanceLocked = false;
  ruleState = [];
  if (rulesListEl) rulesListEl.innerHTML = "";

  if (runStatusEl) {
    runStatusEl.textContent = "Governance rules cleared.";
  }

  appendChatMessage(
    "system",
    "Governance rules have been cleared. Enter new rules and click Submit to continue."
  );
}

/* ============================================================================
   Conversation chat – send, reset, clarifications
   ========================================================================== */

function handleChatSend() {
  if (!chatInputEl) return;
  const text = chatInputEl.value.trim();
  if (!text) return;

  // If awaiting clarification, send this as clarification response
  if (workflowRunning && awaitingClarification && activeClarificationCycle) {
    appendChatMessage("user", text);
    socket.emit("clarification-response", {
      cycle: activeClarificationCycle,
      answer: text,
    });

    awaitingClarification = false;
    activeClarificationCycle = null;

    appendChatMessage(
      "system",
      "Your clarification has been sent to the MCP for this workflow cycle."
    );

    chatInputEl.value = "";
    return;
  }

  // If workflow is running but not expecting clarification, block new task
  if (workflowRunning) {
    appendChatMessage(
      "system",
      "A governed workflow is already in progress. Please wait for it to finish before starting a new task."
    );
    return;
  }

  // Governance must be submitted first
  if (!governanceLocked || !currentGoalText.trim()) {
    appendChatMessage("system", "Please submit governance rules before sending a task.");
    return;
  }

  // Normal new task flow
  appendChatMessage("user", text);
  chatInputEl.value = "";

  startGovernedWorkflow(text);
}

function handleChatReset() {
  if (workflowRunning) {
    appendChatMessage(
      "system",
      "Cannot reset the conversation while a governed workflow is running."
    );
    return;
  }

  clearChatHistory();
  appendChatMessage(
    "system",
    "Conversation reset. Governance rules and logs remain unchanged. You may submit a new task when ready."
  );
}

/* ============================================================================
   Workflow lifecycle
   ========================================================================== */

function startGovernedWorkflow(taskInput) {
  workflowRunning = true;
  awaitingClarification = false;
  activeClarificationCycle = null;
  setStatus("user");

  if (runStatusEl) {
    runStatusEl.textContent = "Running governed workflow…";
  }

  resetWorkflowUIForNewRun();

  const payload = {
    input: taskInput,
    goal: currentGoalText || "",
    maxCycles: getMaxCycles(),
    governanceStrictness: getGovernanceStrictness(),
    perfMode: getPerfMode(),
  };

  socket.emit("run-workflow", payload);
}

function resetWorkflowUIForNewRun() {
  // Clear logs/ledger/cycle indicators but keep chat + governance rules
  if (analyticalLogEl) analyticalLogEl.innerHTML = "";
  if (moderatorLogEl) moderatorLogEl.innerHTML = "";
  if (creativeLogEl) creativeLogEl.innerHTML = "";
  if (ledgerLogEl) ledgerLogEl.innerHTML = "";
  currentLedger = [];

  if (cycleIndicatorEl) cycleIndicatorEl.textContent = "Cycle: –";
  if (mcpDetailEl) mcpDetailEl.textContent = "";

  // Rules remain; their dots will be updated by progress/final events
}

/* ============================================================================
   Socket telemetry handling
   ========================================================================== */

socket.on("telemetry", (payload) => {
  const type = payload && payload.type;

  switch (type) {
    case "reset":
      handleTelemetryReset();
      break;

    case "cycle-plan":
      handleTelemetryCyclePlan(payload.plannedCycles);
      break;

    case "final-output":
      handleTelemetryFinalOutput(payload.text);
      break;

    case "governance-rules":
      handleTelemetryGovernanceRules(payload.rules || []);
      break;

    case "governance-rules-progress":
      handleTelemetryRulesProgress();
      break;

    case "governance-rules-final":
      handleTelemetryRulesFinal();
      break;

    case "mcp-status":
      handleTelemetryMcpStatus(payload.status, payload.detail);
      break;

    case "cycle-update":
      handleTelemetryCycleUpdate(payload.cycle);
      break;

    case "hemisphere-log":
      handleTelemetryHemisphereLog(payload.hemisphere, payload.message);
      break;

    case "moderator-log":
      handleTelemetryModeratorLog(payload.message);
      break;

    case "clarification-request":
      handleTelemetryClarificationRequest(payload);
      break;

    case "ledger":
      handleTelemetryLedger(payload.entries || []);
      break;

    default:
      break;
  }
});

/* ---- Individual telemetry handlers --------------------------------------- */

function handleTelemetryReset() {
  // Server signals start of a run; logs already cleared locally in startGovernedWorkflow
  // but we keep this in case server triggers reset for error cases.
  resetWorkflowUIForNewRun();
}

function handleTelemetryCyclePlan(planned) {
  plannedCycles = Math.max(1, planned || 1);
}

function handleTelemetryFinalOutput(text) {
  // Final governed text flows into chat
  appendChatMessage("system-final", text || "Governed workflow completed with no content.");

  workflowRunning = false;
  awaitingClarification = false;
  activeClarificationCycle = null;

  if (runStatusEl) {
    runStatusEl.textContent = "Governed workflow complete.";
  }
  setStatus("final");

  // After a short delay, we can visually return to Idle state
  setTimeout(() => {
    if (!workflowRunning) {
      setStatus("idle");
    }
  }, 1500);
}

function handleTelemetryGovernanceRules(rules) {
  // Server’s parsed rules; show them (overrides local parse if any differences)
  initGovernanceRules(rules);
}

function handleTelemetryRulesProgress() {
  markRulesProgress();
}

function handleTelemetryRulesFinal() {
  markRulesFinal();
}

function handleTelemetryMcpStatus(status, detail) {
  if (status === "Analytical Pass") {
    setStatus("analytical");
  } else if (status === "Moderator") {
    setStatus("moderator");
  } else if (status === "Creative Pass") {
    setStatus("creative");
  } else if (status === "Finalized") {
    setStatus("final");
  } else if (status === "Error") {
    setStatus("error");
  } else if (status === "Starting") {
    setStatus("analytical"); // treat as pre-analytical startup
  } else {
    setStatus("idle");
  }

  if (mcpDetailEl && typeof detail === "string") {
    mcpDetailEl.textContent = detail;
  }
}

function handleTelemetryCycleUpdate(cycle) {
  if (cycleIndicatorEl) {
    const n = Number(cycle);
    const label = Number.isFinite(n) ? `Cycle: ${n}` : "Cycle: –";
    cycleIndicatorEl.textContent = label;
  }
}

function handleTelemetryHemisphereLog(hemisphere, message) {
  const msg =
    message ||
    (hemisphere === "A"
      ? "Analytical hemisphere log entry."
      : "Creative hemisphere log entry.");

  if (hemisphere === "A") {
    appendLogEntry(analyticalLogEl, "analytical", msg);
  } else {
    appendLogEntry(creativeLogEl, "creative", msg);
  }
}

function handleTelemetryModeratorLog(message) {
  const msg = message || "Moderator log entry.";
  appendLogEntry(moderatorLogEl, "moderator", msg);
}

function handleTelemetryClarificationRequest(payload) {
  const question =
    payload.question ||
    "The MCP needs a brief clarification. Please respond in 1–2 sentences.";
  const confidence = payload.confidence;
  const cycle = payload.cycle || 1;

  awaitingClarification = true;
  activeClarificationCycle = cycle;

  let msg = question;
  if (typeof confidence === "number") {
    const c = confidence.toFixed(2);
    let label = " (model confidence ";
    if (confidence >= 0.75) {
      label += `${c}, high)`;
    } else if (confidence >= 0.45) {
      label += `${c}, medium)`;
    } else {
      label += `${c}, low – asking for clarification)`;
    }
    msg += label;
  }

  appendChatMessage(
    "system",
    `${msg}\n\nPlease reply in this chat to answer the clarification request.`
  );
}

function handleTelemetryLedger(entries) {
  updateLedger(entries);
}

/* ============================================================================
   Logout
   ========================================================================== */

if (logoutButtonEl) {
  logoutButtonEl.addEventListener("click", async () => {
    try {
      await fetch("/auth/logout", { method: "POST" });
    } catch (e) {
      console.error("Logout error", e);
    } finally {
      window.location.href = "/login";
    }
  });
}

/* ============================================================================
   Wire up UI events
   ========================================================================== */

if (chatSendButtonEl) {
  chatSendButtonEl.addEventListener("click", handleChatSend);
}

if (chatInputEl) {
  chatInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleChatSend();
    }
  });
}

if (chatResetButtonEl) {
  chatResetButtonEl.addEventListener("click", handleChatReset);
}

if (goalSubmitButtonEl) {
  goalSubmitButtonEl.addEventListener("click", handleSubmitGovernance);
}

if (goalResetButtonEl) {
  goalResetButtonEl.addEventListener("click", handleResetGovernance);
}

/* Init shared UI bits */
initPerfModeControls();
initLogCollapsibles();

/* Initial greeting */
appendChatMessage(
  "system",
  "cd\\ai governed MVP is ready. Enter governance rules in the Goal / Governance panel, click Submit, then send a task here in the conversation to run a governed workflow."
);
setStatus("idle");
