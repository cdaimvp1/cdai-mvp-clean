// app.js – cd\ai MVP front-end logic

const socket = io();

// ==============================
// DOM REFERENCES
// ==============================

// Header
const statusDynamicEl = document.getElementById("status-label-dynamic");
const strictnessSliderEl = document.getElementById("strictness-slider");
const strictnessValueEl = document.getElementById("strictness-value");
const cycleSliderEl = document.getElementById("cycle-slider");
const cycleValueEl = document.getElementById("cycle-value");
const modeRealBtn = document.getElementById("mode-real");
const modeFastBtn = document.getElementById("mode-fast");
const modeTurboBtn = document.getElementById("mode-turbo");
const logoutButtonEl = document.getElementById("logout-button");

// Chat / governance conversation
const chatHistoryEl = document.getElementById("chat-history");
const chatInputEl = document.getElementById("chat-input");
const chatSendButtonEl = document.getElementById("chat-send-button");
const chatResetButtonEl = document.getElementById("chat-reset-button");

// Goal / Governance rules input
const goalInputEl = document.getElementById("goal-input");
const goalResetButtonEl = document.getElementById("goal-reset-button");
const goalSubmitButtonEl = document.getElementById("goal-submit-button");

// Governance rules display
const rulesListEl = document.getElementById("rules-list");

// Logs
const analyticalLogEl = document.getElementById("analytical-log");
const moderatorLogEl = document.getElementById("moderator-log");
const creativeLogEl = document.getElementById("creative-log");
const ledgerLogEl = document.getElementById("ledger-log");

// Ledger controls
const ledgerPanelEl = document.getElementById("ledger-panel");
const downloadLedgerBtn = document.getElementById("download-ledger-btn");

// Collapsible log panels
const logPanels = document.querySelectorAll(".log-panel");

// ==============================
// STATE
// ==============================

let isWorkflowRunning = false;
let governanceLocked = false;
let currentGoalText = "";
let currentPerfMode = "real";
let currentRules = []; // [{ text, origin: 'user'|'system'|'user-clarified', status: 'pending'|'in-progress'|'passed' }]
let currentLedger = [];

// For MCP ↔ user clarification loop
let pendingClarification = null; // { cycle, question, confidence }

// ==============================
// SMALL HELPERS
// ==============================

function nowDateTime() {
  // Date + time, 24h, locale friendly
  return new Date().toLocaleString(undefined, { hour12: false });
}

function setStatus(status) {
  if (!statusDynamicEl) return;

  const normalized = (status || "Idle").toLowerCase();
  statusDynamicEl.textContent =
    status === "Starting" ? "Starting" : status || "Idle";

  // Reset classes
  statusDynamicEl.className = "status-label-dynamic";

  // Add color class
  if (normalized.includes("analytical")) {
    statusDynamicEl.classList.add("status-analytical");
  } else if (normalized.includes("moderator")) {
    statusDynamicEl.classList.add("status-moderator");
  } else if (normalized.includes("creative")) {
    statusDynamicEl.classList.add("status-creative");
  } else if (normalized.includes("validator")) {
    statusDynamicEl.classList.add("status-validator");
  } else if (normalized.includes("user")) {
    statusDynamicEl.classList.add("status-user");
  } else if (normalized.includes("final")) {
    statusDynamicEl.classList.add("status-final");
  } else if (normalized.includes("error")) {
    statusDynamicEl.classList.add("status-error");
  } else {
    statusDynamicEl.classList.add("status-idle");
  }
}

function getStrictness() {
  const v = parseFloat(strictnessSliderEl?.value ?? "0.85");
  if (!Number.isFinite(v)) return 0.85;
  return Math.min(1, Math.max(0, v));
}

function getMaxCycles() {
  const v = parseInt(cycleSliderEl?.value ?? "5", 10);
  if (!Number.isFinite(v)) return 5;
  return Math.min(10, Math.max(1, v));
}

function getPerfMode() {
  return currentPerfMode || "real";
}

function parseRulesFromText(text) {
  if (!text) return [];
  return text
    .split(/\n|;/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ==============================
// UI: CHAT
// ==============================

function appendChatMessage({ text, sender, isFinal = false }) {
  if (!chatHistoryEl || !text) return;

  const div = document.createElement("div");
  div.classList.add("chat-message");

  if (isFinal) {
    div.classList.add("final");
  } else if (sender === "user") {
    div.classList.add("user");
  } else {
    div.classList.add("system");
  }

  div.textContent = text;
  chatHistoryEl.appendChild(div);
  chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
}

function resetConversationIfAllowed() {
  if (isWorkflowRunning) return;
  if (chatHistoryEl) chatHistoryEl.innerHTML = "";
  pendingClarification = null;
}

// ==============================
// UI: RULES PANEL
// ==============================

function renderRules() {
  if (!rulesListEl) return;
  rulesListEl.innerHTML = "";

  currentRules.forEach((rule, index) => {
    const li = document.createElement("li");
    li.dataset.index = String(index);

    const dot = document.createElement("span");
    dot.classList.add("rule-status-dot");
    dot.classList.add(rule.status || "pending");

    const textSpan = document.createElement("span");
    textSpan.classList.add("rule-text");
    if (rule.origin === "system" || rule.origin === "system_inferred") {
      textSpan.classList.add("rule-system-generated");
    } else if (rule.origin === "user-clarified") {
      textSpan.classList.add("rule-user-clarified");
    }

    textSpan.textContent = rule.text;

    li.appendChild(dot);
    li.appendChild(textSpan);
    rulesListEl.appendChild(li);
  });
}

function initRulesFromServer(payloadRules) {
  const incoming = Array.isArray(payloadRules) ? payloadRules : [];

  if (!incoming.length && currentGoalText) {
    // fallback: parse from current goal
    const parsed = parseRulesFromText(currentGoalText);
    currentRules = parsed.map((t) => ({
      text: t,
      origin: "user",
      status: "pending",
    }));
  } else {
    currentRules = incoming.map((r) => {
      if (typeof r === "string") {
        return { text: r, origin: "user", status: "pending" };
      }
      return {
        text: r.text || r.rule || "",
        origin: r.origin || "user",
        status: r.status || "pending",
      };
    });
  }

  renderRules();
}

function markRulesProgress() {
  // simple step: first pending → in-progress, first in-progress → passed
  for (let i = 0; i < currentRules.length; i++) {
    const rule = currentRules[i];
    if (rule.status === "pending") {
      rule.status = "in-progress";
      break;
    } else if (rule.status === "in-progress") {
      rule.status = "passed";
      break;
    }
  }
  renderRules();
}

function markRulesFinal() {
  currentRules = currentRules.map((r) => ({
    ...r,
    status: "passed",
  }));
  renderRules();
}

// ==============================
// UI: LOGS
// ==============================

function appendAnalyticalLog(message) {
  if (!analyticalLogEl) return;
  const div = document.createElement("div");
  div.className = "log-entry analytical";
  div.innerHTML = `<span class="timestamp">${nowDateTime()}</span>${escapeHtml(
    message
  )}`;
  analyticalLogEl.appendChild(div);
  analyticalLogEl.scrollTop = analyticalLogEl.scrollHeight;
}

function appendModeratorLog(message) {
  if (!moderatorLogEl) return;
  const div = document.createElement("div");
  div.className = "log-entry moderator";
  div.innerHTML = `<span class="timestamp">${nowDateTime()}</span>${escapeHtml(
    message
  )}`;
  moderatorLogEl.appendChild(div);
  moderatorLogEl.scrollTop = moderatorLogEl.scrollHeight;
}

function appendCreativeLog(message) {
  if (!creativeLogEl) return;
  const div = document.createElement("div");
  div.className = "log-entry creative";
  div.innerHTML = `<span class="timestamp">${nowDateTime()}</span>${escapeHtml(
    message
  )}`;
  creativeLogEl.appendChild(div);
  creativeLogEl.scrollTop = creativeLogEl.scrollHeight;
}

function updateLedger(entries) {
  currentLedger = Array.isArray(entries) ? [...entries] : [];
  if (!ledgerLogEl) return;

  ledgerLogEl.innerHTML = "";
  currentLedger.forEach((e) => {
    const div = document.createElement("div");
    div.className = "log-entry ledger";
    const ts = e.timestamp || nowDateTime();
    div.innerHTML = `<span class="timestamp">${escapeHtml(
      ts
    )}</span>[${escapeHtml(e.stage)} – cycle ${escapeHtml(
      String(e.cycle)
    )}] ${escapeHtml(e.summary || "")}`;
    ledgerLogEl.appendChild(div);
  });

  ledgerLogEl.scrollTop = ledgerLogEl.scrollHeight;
}

function resetLogsAndLedger() {
  if (analyticalLogEl) analyticalLogEl.innerHTML = "";
  if (moderatorLogEl) moderatorLogEl.innerHTML = "";
  if (creativeLogEl) creativeLogEl.innerHTML = "";
  if (ledgerLogEl) ledgerLogEl.innerHTML = "";
  currentLedger = [];
}

// ==============================
// UI: COLLAPSIBLE PANELS
// ==============================

function initCollapsibles() {
  logPanels.forEach((panel) => {
    const btn = panel.querySelector(".chevron-btn");
    if (!btn) return;
    btn.addEventListener("click", () => {
      panel.classList.toggle("collapsed");
    });
  });
}

// ==============================
// UI: LEDGER DOWNLOAD
// ==============================

if (downloadLedgerBtn) {
  downloadLedgerBtn.addEventListener("click", () => {
    if (!currentLedger.length) {
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

// ==============================
// UI: HEADER CONTROLS
// ==============================

function updateSliderLabels() {
  if (strictnessValueEl && strictnessSliderEl) {
    strictnessValueEl.textContent = getStrictness().toFixed(2);
  }
  if (cycleValueEl && cycleSliderEl) {
    cycleValueEl.textContent = String(getMaxCycles());
  }
}

if (strictnessSliderEl) {
  strictnessSliderEl.addEventListener("input", updateSliderLabels);
}
if (cycleSliderEl) {
  cycleSliderEl.addEventListener("input", updateSliderLabels);
}
updateSliderLabels();

function setPerfMode(mode) {
  currentPerfMode = mode;
  [modeRealBtn, modeFastBtn, modeTurboBtn].forEach((btn) => {
    if (!btn) return;
    btn.classList.remove("active");
  });

  if (mode === "real" && modeRealBtn) modeRealBtn.classList.add("active");
  if (mode === "fast" && modeFastBtn) modeFastBtn.classList.add("active");
  if (mode === "turbo" && modeTurboBtn) modeTurboBtn.classList.add("active");
}

if (modeRealBtn)
  modeRealBtn.addEventListener("click", () => setPerfMode("real"));
if (modeFastBtn)
  modeFastBtn.addEventListener("click", () => setPerfMode("fast"));
if (modeTurboBtn)
  modeTurboBtn.addEventListener("click", () => setPerfMode("turbo"));

setPerfMode("real");

// Logout
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

// ==============================
// UI: GOAL / GOVERNANCE CONTROLS
// ==============================

function lockGovernance() {
  if (!goalInputEl) return;
  const text = goalInputEl.value.trim();
  currentGoalText = text;
  governanceLocked = true;

  const parsed = parseRulesFromText(text);
  currentRules = parsed.map((r) => ({
    text: r,
    origin: "user",
    status: "pending",
  }));
  renderRules();

  appendChatMessage({
    sender: "system",
    text: "Governance rules submitted. All subsequent runs will enforce this configuration until you reset or change them.",
  });
}

if (goalSubmitButtonEl) {
  goalSubmitButtonEl.addEventListener("click", () => {
    if (isWorkflowRunning) {
      appendChatMessage({
        sender: "system",
        text: "Cannot change governance while a workflow is running. Please wait for completion.",
      });
      return;
    }
    lockGovernance();
  });
}

if (goalResetButtonEl) {
  goalResetButtonEl.addEventListener("click", () => {
    if (isWorkflowRunning) {
      appendChatMessage({
        sender: "system",
        text: "Cannot reset governance while a workflow is running.",
      });
      return;
    }
    if (goalInputEl) goalInputEl.value = "";
    governanceLocked = false;
    currentGoalText = "";
    currentRules = [];
    renderRules();
    appendChatMessage({
      sender: "system",
      text: "Governance rules cleared. Submit new rules before running the next task.",
    });
  });
}

// ==============================
// CHAT SEND HANDLER
// ==============================

function handleChatSend() {
  const raw = (chatInputEl?.value ?? "").trim();
  if (!raw) return;

  // Always append user's message for visibility
  appendChatMessage({ text: raw, sender: "user" });
  if (chatInputEl) chatInputEl.value = "";

  // If we are in a clarification loop, treat this as the answer
  if (pendingClarification && typeof pendingClarification.cycle === "number") {
    socket.emit("clarification-response", {
      cycle: pendingClarification.cycle,
      answer: raw,
    });

    appendChatMessage({
      sender: "system",
      text: "Clarification sent to the MCP. The governed workflow will continue.",
    });

    pendingClarification = null;
    return;
  }

  // Otherwise this is a new task request
  if (!governanceLocked) {
    appendChatMessage({
      sender: "system",
      text: "Please submit your governance rules before running a task.",
    });
    return;
  }

  if (isWorkflowRunning) {
    appendChatMessage({
      sender: "system",
      text: "A governed workflow is already running. Please wait until it completes.",
    });
    return;
  }

  runGovernedWorkflow(raw);
}

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
  chatResetButtonEl.addEventListener("click", () => {
    resetConversationIfAllowed();
  });
}

// ==============================
// RUN GOVERNED WORKFLOW
// ==============================

function runGovernedWorkflow(taskText) {
  isWorkflowRunning = true;
  setStatus("Starting");

  const payload = {
    input: taskText,
    goal: currentGoalText,
    maxCycles: getMaxCycles(),
    governanceStrictness: getStrictness(),
    perfMode: getPerfMode(),
  };

  socket.emit("run-workflow", payload);
}

// ==============================
// SOCKET.IO TELEMETRY
// ==============================

socket.on("telemetry", (payload) => {
  if (!payload || !payload.type) return;

  switch (payload.type) {
    case "reset":
      // clear logs + ledger, but keep chat and rules
      resetLogsAndLedger();
      // reset rule statuses to pending if already defined
      currentRules = currentRules.map((r) => ({ ...r, status: "pending" }));
      renderRules();
      pendingClarification = null;
      break;

    case "cycle-plan":
      // Currently used only for animation in prior design – no-op here.
      break;

    case "final-output":
      handleFinalOutput(payload.text);
      break;

    case "governance-rules":
      initRulesFromServer(payload.rules || []);
      break;

    case "governance-rules-progress":
      markRulesProgress();
      break;

    case "governance-rules-final":
      markRulesFinal();
      break;

    case "mcp-status":
      if (payload.status) {
        setStatus(payload.status);
      }
      break;

    case "cycle-update":
      // No explicit UI element tied to this in the new layout.
      break;

    case "hemisphere-log":
      if (payload.hemisphere === "A") {
        appendAnalyticalLog(payload.message || "");
      } else {
        appendCreativeLog(payload.message || "");
      }
      break;

    case "moderator-log":
      appendModeratorLog(payload.message || "");
      break;

    case "clarification-request":
      handleClarificationRequest(payload);
      break;

    case "ledger":
      updateLedger(payload.entries || []);
      break;

    default:
      break;
  }
});

// ==============================
// FINAL OUTPUT HANDLER
// ==============================

function handleFinalOutput(text) {
  isWorkflowRunning = false;
  setStatus("Final");
  appendChatMessage({
    text: text || "No final text returned.",
    sender: "system",
    isFinal: true,
  });
}

// ==============================
// CLARIFICATION HANDLER
// ==============================

function handleClarificationRequest(payload) {
  const { question, confidence, cycle } = payload || {};

  pendingClarification = {
    cycle: typeof cycle === "number" ? cycle : null,
    question: question || null,
    confidence:
      typeof confidence === "number" ? confidence : null,
  };

  let msg = question || "The MCP is requesting a brief clarification.";
  if (typeof confidence === "number") {
    let tier;
    if (confidence >= 0.75) tier = "high-confidence inference";
    else if (confidence >= 0.45) tier = "medium-confidence inference";
    else tier = "low-confidence inference";
    msg += ` (inference tier: ${tier}, score: ${confidence.toFixed(2)})`;
  }

  appendChatMessage({
    sender: "system",
    text: msg,
  });

  appendChatMessage({
    sender: "system",
    text: "Please respond in 1–2 sentences in the chat. Your answer will be applied as a clarified rule for the next cycle.",
  });
}

// ==============================
// ESCAPE HTML UTILITY
// ==============================

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

// ==============================
// INIT
// ==============================

document.addEventListener("DOMContentLoaded", () => {
  initCollapsibles();
  setStatus("Idle");
});
