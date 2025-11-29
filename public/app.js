/* cd\ai Governed MVP – front-end controller */

const socket = io();

/* ---------------------------------------------------------------------------
   DOM references
--------------------------------------------------------------------------- */

// Conversation
const messageListEl = document.getElementById("message-list");
const conversationBodyEl = document.getElementById("conversation-body");
const chatInputEl = document.getElementById("chat-input");
const chatSendBtnEl = document.getElementById("chat-send-button");
const conversationResetBtnEl = document.getElementById("conversation-reset");
const runStatusEl = document.getElementById("run-status");

// Governance
const goalInputEl = document.getElementById("goal-input");
const governanceSubmitBtnEl = document.getElementById("governance-submit");
const governanceResetBtnEl = document.getElementById("governance-reset");
const governanceStatusEl = document.getElementById("governance-status");
const rulesListEl = document.getElementById("rules-list");

// Header controls
const statusPillEl = document.getElementById("status-pill");
const strictnessSliderEl = document.getElementById("strictness-slider");
const strictnessValueEl = document.getElementById("strictness-value");
const cycleSliderEl = document.getElementById("cycle-slider");
const cycleSliderValueEl = document.getElementById("cycle-slider-value");
const perfPills = document.querySelectorAll(".perf-pill");
const logoutButtonEl = document.getElementById("logout-button");

// MCP & logs
const cycleIndicatorEl = document.getElementById("cycle-indicator");
const mcpDetailEl = document.getElementById("mcp-detail");

const analyticalLogEl = document.getElementById("analytical-log");
const creativeLogEl = document.getElementById("creative-log");
const moderatorLogEl = document.getElementById("moderator-log");
const ledgerLogEl = document.getElementById("ledger-log");

const collapsibleCards = document.querySelectorAll(".log-card");
const downloadLedgerBtn = document.getElementById("download-ledger-btn");

/* ---------------------------------------------------------------------------
   State
--------------------------------------------------------------------------- */

let governanceLocked = false;
let governanceText = "";
let runInProgress = false;
let activeClarificationCycle = null;
let currentLedger = [];
let ruleState = [];

/* ---------------------------------------------------------------------------
   Utility helpers
--------------------------------------------------------------------------- */

function formatDateTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
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

function setRunStatus(text) {
  if (runStatusEl) {
    runStatusEl.textContent = text || "";
  }
}

function setRunInProgress(flag) {
  runInProgress = !!flag;
  const disabled = !!flag;

  if (conversationResetBtnEl) {
    conversationResetBtnEl.disabled = disabled;
  }
  if (governanceResetBtnEl) {
    governanceResetBtnEl.disabled = disabled;
  }
  if (governanceSubmitBtnEl) {
    governanceSubmitBtnEl.disabled = disabled;
  }
}

/* ---------------------------------------------------------------------------
   Controls: sliders & perf mode
--------------------------------------------------------------------------- */

function syncStrictnessLabel() {
  if (!strictnessSliderEl || !strictnessValueEl) return;
  const v = Number(strictnessSliderEl.value);
  strictnessValueEl.textContent = Number.isFinite(v)
    ? v.toFixed(2)
    : "0.85";
}

function syncCycleLabel() {
  if (!cycleSliderEl || !cycleSliderValueEl) return;
  cycleSliderValueEl.textContent = cycleSliderEl.value || "5";
}

if (strictnessSliderEl) {
  strictnessSliderEl.addEventListener("input", syncStrictnessLabel);
  syncStrictnessLabel();
}

if (cycleSliderEl) {
  cycleSliderEl.addEventListener("input", syncCycleLabel);
  syncCycleLabel();
}

// Perf mode pills: Real / Fast / Turbo
if (perfPills && perfPills.length) {
  perfPills.forEach((pill) => {
    pill.addEventListener("click", () => {
      perfPills.forEach((p) => p.classList.remove("perf-pill-active"));
      pill.classList.add("perf-pill-active");
    });
  });
}

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
  let mode = "real";
  perfPills.forEach((pill) => {
    if (pill.classList.contains("perf-pill-active")) {
      mode = pill.getAttribute("data-mode") || "real";
    }
  });
  return mode;
}

/* ---------------------------------------------------------------------------
   Conversation chat helpers
--------------------------------------------------------------------------- */

function appendChatMessage(role, text, options = {}) {
  if (!messageListEl) return;

  const { variant } = options; // e.g., "final"

  const row = document.createElement("div");
  row.classList.add("message-row");
  row.classList.add(role === "user" ? "user" : "system");

  const bubble = document.createElement("div");
  bubble.classList.add("message-bubble");
  if (role === "user") {
    bubble.classList.add("bubble-user");
  } else if (variant === "final") {
    bubble.classList.add("bubble-final");
  } else {
    bubble.classList.add("bubble-system");
  }

  const textSpan = document.createElement("div");
  textSpan.classList.add("message-text");
  textSpan.textContent = text;

  const meta = document.createElement("div");
  meta.classList.add("message-meta");
  const label = role === "user" ? "User" : "cd\\ai MCP";
  meta.textContent = `${label} · ${formatDateTime(new Date())}`;

  bubble.appendChild(textSpan);
  bubble.appendChild(meta);
  row.appendChild(bubble);
  messageListEl.appendChild(row);

  if (conversationBodyEl) {
    conversationBodyEl.scrollTop = conversationBodyEl.scrollHeight;
  }
}

function appendInitialSystemMessage() {
  appendChatMessage(
    "system",
    "Welcome to the cd\\ai governed demo.\n\n1) Paste and submit the goal / governance rules.\n2) Then describe a task here in the conversation. The MCP will run under the locked governance envelope.\n\nAny clarifications from the MCP will also appear in this conversation.",
  );
}

/* ---------------------------------------------------------------------------
   Governance parsing + rules UI
--------------------------------------------------------------------------- */

function parseRules(goalText) {
  if (!goalText) return [];
  return goalText
    .split(/\n|;/)
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
}

function initGovernanceRules(rules) {
  if (!rulesListEl) return;

  rulesListEl.innerHTML = "";
  ruleState = (rules || []).map((text) => ({
    text,
    status: "pending",
  }));

  ruleState.forEach((rule, index) => {
    const li = document.createElement("li");
    li.dataset.index = String(index);

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

function markRulesProgress(_cycle) {
  if (!rulesListEl || !ruleState.length) return;

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
  if (!rulesListEl || !ruleState.length) return;

  ruleState.forEach((rule, index) => {
    rule.status = "passed";
    const li = rulesListEl.querySelector(`li[data-index="${index}"]`);
    if (!li) return;
    const dot = li.querySelector(".rule-status-dot");
    if (!dot) return;
    dot.className = "rule-status-dot passed";
  });
}

/* ---------------------------------------------------------------------------
   MCP status & logs
--------------------------------------------------------------------------- */

function updateMcpStatus(status, detail) {
  // Update header status bubble
  let pillClass = "status-pill status-idle";
  let label = "Idle";

  switch (status) {
    case "Starting":
      label = "Starting";
      pillClass = "status-pill status-idle";
      setRunStatus("Starting governed workflow…");
      break;
    case "Analytical Pass":
      label = "Analytical";
      pillClass = "status-pill status-analytical";
      setRunStatus("Running analytical hemisphere pass…");
      break;
    case "Moderator":
      label = "Moderator";
      pillClass = "status-pill status-moderator";
      setRunStatus("Moderator framing creative behavior…");
      break;
    case "Creative Pass":
      label = "Creative";
      pillClass = "status-pill status-creative";
      setRunStatus("Running creative hemisphere pass…");
      break;
    case "Finalized":
      label = "Final";
      pillClass = "status-pill status-final";
      setRunStatus("Governed workflow complete.");
      setRunInProgress(false);
      activeClarificationCycle = null;
      break;
    case "Error":
      label = "Error";
      pillClass = "status-pill status-error";
      setRunStatus("Error during governed workflow.");
      setRunInProgress(false);
      activeClarificationCycle = null;
      break;
    default:
      label = "Idle";
      pillClass = "status-pill status-idle";
  }

  if (statusPillEl) {
    statusPillEl.className = pillClass;
    statusPillEl.textContent = `Status | ${label}`;
  }

  if (detail && mcpDetailEl) {
    mcpDetailEl.textContent = detail;
  }
}

function appendHemisphereLog(hemisphere, message) {
  const entry = document.createElement("div");
  entry.className =
    "log-entry " + (hemisphere === "A" ? "analytical" : "creative");
  entry.innerHTML = `<span class="timestamp">${formatDateTime(
    new Date(),
  )}</span>${escapeHtml(message)}`;

  if (hemisphere === "A") {
    analyticalLogEl.appendChild(entry);
    analyticalLogEl.scrollTop = analyticalLogEl.scrollHeight;
  } else {
    creativeLogEl.appendChild(entry);
    creativeLogEl.scrollTop = creativeLogEl.scrollHeight;
  }
}

function appendModeratorLog(message) {
  if (!moderatorLogEl) return;
  const entry = document.createElement("div");
  entry.className = "log-entry moderator";
  entry.innerHTML = `<span class="timestamp">${formatDateTime(
    new Date(),
  )}</span>${escapeHtml(message)}`;
  moderatorLogEl.appendChild(entry);
  moderatorLogEl.scrollTop = moderatorLogEl.scrollHeight;
}

function updateLedger(entries) {
  currentLedger = entries.slice();
  ledgerLogEl.innerHTML = "";

  currentLedger.forEach((e) => {
    const div = document.createElement("div");
    div.className = "log-entry ledger";
    const ts = e.timestamp ? formatDateTime(e.timestamp) : formatDateTime(new Date());
    div.innerHTML = `<span class="timestamp">${escapeHtml(
      ts,
    )}</span>[${escapeHtml(e.stage)} – cycle ${
      typeof e.cycle === "number" ? e.cycle : "-"
    }] ${escapeHtml(e.summary || "")}`;
    ledgerLogEl.appendChild(div);
  });

  ledgerLogEl.scrollTop = ledgerLogEl.scrollHeight;
}

/* Called when server emits telemetry type "reset" at the start of a run */
function resetRunUI() {
  activeClarificationCycle = null;
  currentLedger = [];

  if (analyticalLogEl) analyticalLogEl.innerHTML = "";
  if (creativeLogEl) creativeLogEl.innerHTML = "";
  if (moderatorLogEl) moderatorLogEl.innerHTML = "";
  if (ledgerLogEl) ledgerLogEl.innerHTML = "";

  if (cycleIndicatorEl) {
    cycleIndicatorEl.textContent = "Cycle: –";
  }
  if (mcpDetailEl) {
    mcpDetailEl.textContent = "Initializing governed workflow…";
  }
  setRunStatus("Running governed workflow…");
}

/* ---------------------------------------------------------------------------
   Clarification handling (via conversation chat)
--------------------------------------------------------------------------- */

function showClarificationRequest(payload) {
  const { question, confidence, cycle } = payload || {};
  activeClarificationCycle = typeof cycle === "number" ? cycle : 1;

  let msg = "The MCP moderator is requesting a brief clarification.";
  if (question) {
    msg += `\n\nQuestion: ${question}`;
  }
  if (typeof confidence === "number") {
    let confLabel = "model confidence ";
    if (confidence >= 0.75) {
      confLabel += `${confidence.toFixed(2)} (high)`;
    } else if (confidence >= 0.45) {
      confLabel += `${confidence.toFixed(2)} (medium)`;
    } else {
      confLabel += `${confidence.toFixed(2)} (low – asking for clarification)`;
    }
    msg += `\n\n${confLabel}.`;
  }

  appendChatMessage("system", msg);
  setRunStatus("Awaiting user clarification…");
}

/* ---------------------------------------------------------------------------
   Conversation events
--------------------------------------------------------------------------- */

function handleSendChat() {
  if (!chatInputEl || !chatSendBtnEl) return;

  const text = chatInputEl.value.trim();
  if (!text) return;

  chatInputEl.value = "";
  appendChatMessage("user", text);

  // If MCP is waiting for clarification, send that instead of starting a new run
  if (activeClarificationCycle !== null) {
    socket.emit("clarification-response", {
      cycle: activeClarificationCycle,
      answer: text,
    });
    activeClarificationCycle = null;
    setRunStatus("Clarification sent to MCP. Continuing governed workflow…");
    return;
  }

  // If governance is not yet locked, nudge the user
  if (!governanceLocked) {
    appendChatMessage(
      "system",
      "Governance rules must be submitted before starting a governed workflow. Please define them in the Goal / Governance Rules panel.",
    );
    return;
  }

  // Prevent overlapping runs
  if (runInProgress) {
    appendChatMessage(
      "system",
      "A governed workflow is already running. Wait for it to complete before starting another task.",
    );
    return;
  }

  // Start a governed workflow with the current chat message as the Task input
  const payload = {
    input: text,
    goal: governanceText,
    maxCycles: getMaxCycles(),
    governanceStrictness: getGovernanceStrictness(),
    perfMode: getPerfMode(),
  };

  setRunInProgress(true);
  setRunStatus("Starting governed workflow…");

  socket.emit("run-workflow", payload);

  appendChatMessage(
    "system",
    "Task received. The governed MCP is running under the current governance envelope.",
  );
}

if (chatSendBtnEl) {
  chatSendBtnEl.addEventListener("click", handleSendChat);
}

if (chatInputEl) {
  chatInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSendChat();
    }
  });
}

/* Conversation reset */
if (conversationResetBtnEl) {
  conversationResetBtnEl.addEventListener("click", () => {
    if (runInProgress) {
      setRunStatus(
        "Cannot reset conversation while a governed workflow is running.",
      );
      return;
    }
    if (messageListEl) {
      messageListEl.innerHTML = "";
    }
    appendInitialSystemMessage();
    setRunStatus("Idle");
  });
}

/* ---------------------------------------------------------------------------
   Governance events
--------------------------------------------------------------------------- */

if (governanceSubmitBtnEl) {
  governanceSubmitBtnEl.addEventListener("click", () => {
    if (runInProgress) {
      governanceStatusEl.textContent =
        "Cannot submit new governance rules while a workflow is running.";
      return;
    }

    const text = (goalInputEl?.value || "").trim();
    if (!text) {
      governanceStatusEl.textContent =
        "Enter governance rules before submitting.";
      return;
    }

    governanceText = text;
    governanceLocked = true;
    governanceStatusEl.textContent =
      "Governance rules submitted. All tasks will run under this envelope until reset.";

    const rules = parseRules(governanceText);
    initGovernanceRules(rules);

    appendChatMessage(
      "system",
      "Governance rules have been submitted and locked for this session.\n\nYou can now describe a governed task in the conversation.",
    );
  });
}

if (governanceResetBtnEl) {
  governanceResetBtnEl.addEventListener("click", () => {
    if (runInProgress) {
      governanceStatusEl.textContent =
        "Cannot reset governance while a workflow is running.";
      return;
    }

    governanceText = "";
    governanceLocked = false;

    if (goalInputEl) goalInputEl.value = "";
    if (rulesListEl) rulesListEl.innerHTML = "";
    ruleState = [];

    governanceStatusEl.textContent =
      "Governance rules cleared. Submit a new envelope to continue.";

    appendChatMessage(
      "system",
      "Governance rules have been cleared. Submit new rules before starting another governed task.",
    );
  });
}

/* ---------------------------------------------------------------------------
   Collapsible log panels & ledger download
--------------------------------------------------------------------------- */

collapsibleCards.forEach((card) => {
  const btn = card.querySelector(".chevron-btn");
  if (!btn) return;

  btn.addEventListener("click", () => {
    card.classList.toggle("collapsed");
  });
});

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

/* ---------------------------------------------------------------------------
   Logout
--------------------------------------------------------------------------- */

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

/* ---------------------------------------------------------------------------
   Socket telemetry wiring
--------------------------------------------------------------------------- */

socket.on("telemetry", (payload) => {
  switch (payload.type) {
    case "reset":
      resetRunUI();
      break;

    case "cycle-plan":
      // We no longer animate hemispheric flow; nothing required here.
      break;

    case "cycle-update":
      if (
        cycleIndicatorEl &&
        typeof payload.cycle === "number" &&
        Number.isFinite(payload.cycle)
      ) {
        cycleIndicatorEl.textContent = `Cycle: ${payload.cycle}`;
      }
      break;

    case "final-output":
      handleFinalOutput(payload.text);
      break;

    case "governance-rules":
      initGovernanceRules(payload.rules || []);
      break;

    case "governance-rules-progress":
      markRulesProgress(payload.cycle);
      break;

    case "governance-rules-final":
      markRulesFinal();
      break;

    case "mcp-status":
      updateMcpStatus(payload.status, payload.detail);
      break;

    case "hemisphere-log":
      appendHemisphereLog(payload.hemisphere, payload.message);
      break;

    case "moderator-log":
      appendModeratorLog(payload.message);
      break;

    case "clarification-request":
      showClarificationRequest(payload);
      break;

    case "ledger":
      updateLedger(payload.entries || []);
      break;

    default:
      break;
  }
});

/* Handle final governed output by posting into the conversation */
function handleFinalOutput(text) {
  const output = text || "";
  appendChatMessage("system", output, { variant: "final" });
  setRunStatus("Governed workflow complete.");
  setRunInProgress(false);
  activeClarificationCycle = null;
}

/* ---------------------------------------------------------------------------
   Bootstrap
--------------------------------------------------------------------------- */

appendInitialSystemMessage();
setRunStatus("Idle");
