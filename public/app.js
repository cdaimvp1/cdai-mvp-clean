// app.js – cd\ai MVP front-end logic (meta-governance ready)

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

/**
 * currentRules: array of objects like:
 * {
 *   id: string | number | null,
 *   text: string,
 *   origin: "user" | "system" | "system_inferred" | "user-clarified" | "ignored" | "conflicted",
 *   status: "pending" | "in-progress" | "passed" | "ignored" | "conflicted",
 *   confidence: number | null,
 *   severity: "Low" | "Moderate" | "High" | "Critical" | null,
 *   impact: string | null,
 *   explanation: string | null,
 *   escalationTargets: string[] | null,
 *   applied: boolean | null
 * }
 */
let currentRules = [];

let currentLedger = [];

// For MCP ↔ user clarification loop
let pendingClarification = null; // { cycle, question, confidence }

// For universal governance object (backend schema)
let currentGovernanceObject = null;

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
  currentGovernanceObject = null;
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

    // Origin-based coloring (UI indicators for rule states)
    if (rule.origin === "system" || rule.origin === "system_inferred") {
      textSpan.classList.add("rule-system-generated");
    } else if (rule.origin === "user-clarified") {
      textSpan.classList.add("rule-user-clarified");
    } else if (rule.origin === "ignored") {
      textSpan.classList.add("rule-ignored");
    } else if (rule.origin === "conflicted") {
      textSpan.classList.add("rule-conflicted");
    }

    let label = rule.text || "";

    // Attach severity/impact inline, if present
    const sev = rule.severity || null;
    const impact = rule.impact || null;
    const applied = rule.applied === false ? " (not applied)" : "";

    if (sev || impact || applied) {
      const detailParts = [];
      if (sev) detailParts.push(`Sev: ${sev}`);
      if (impact) detailParts.push(`Impact: ${impact}`);
      if (applied) detailParts.push(`State:${applied}`);
      label += `  [${detailParts.join(" | ")}]`;
    }

    if (rule.explanation) {
      label += ` — ${rule.explanation}`;
    }

    textSpan.textContent = label;

    li.appendChild(dot);
    li.appendChild(textSpan);
    rulesListEl.appendChild(li);
  });
}

function normalizeIncomingRule(raw, defaultOrigin = "user") {
  if (!raw) {
    return {
      id: null,
      text: "",
      origin: defaultOrigin,
      status: "pending",
      confidence: null,
      severity: null,
      impact: null,
      explanation: null,
      escalationTargets: null,
      applied: null,
    };
  }

  // Accept strings or objects
  if (typeof raw === "string") {
    return {
      id: null,
      text: raw,
      origin: defaultOrigin,
      status: "pending",
      confidence: null,
      severity: null,
      impact: null,
      explanation: null,
      escalationTargets: null,
      applied: null,
    };
  }

  return {
    id: raw.id ?? null,
    text: raw.text || raw.rule || "",
    origin:
      raw.origin ||
      (raw.inferred ? "system_inferred" : raw.clarified ? "user-clarified" : defaultOrigin),
    status: raw.status || (raw.ignored ? "ignored" : "pending"),
    confidence:
      typeof raw.confidence === "number" ? raw.confidence : null,
    severity: raw.severity || null,
    impact: raw.impact || null,
    explanation: raw.explanation || null,
    escalationTargets:
      Array.isArray(raw.escalationTargets) ? raw.escalationTargets : null,
    applied:
      typeof raw.applied === "boolean"
        ? raw.applied
        : raw.status === "ignored"
        ? false
        : null,
  };
}

function initRulesFromServer(payloadRules) {
  const incoming = Array.isArray(payloadRules) ? payloadRules : [];

  if (!incoming.length && currentGoalText) {
    // fallback: parse from current goal
    const parsed = parseRulesFromText(currentGoalText);
    currentRules = parsed.map((t) =>
      normalizeIncomingRule({ text: t, origin: "user", status: "pending" })
    );
  } else {
    currentRules = incoming.map((r) => normalizeIncomingRule(r, "user"));
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
  currentRules = currentRules.map((r) => {
    if (r.status === "ignored" || r.status === "conflicted") return r;
    return {
      ...r,
      status: "passed",
      applied: true,
    };
  });
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

    // Some ledger entries may have richer payloads; keep it readable.
    const stage = e.stage || "Stage";
    const cycle = e.cycle ?? "-";
    const summary = e.summary || "";

    div.innerHTML = `<span class="timestamp">${escapeHtml(
      ts
    )}</span>[${escapeHtml(stage)} – cycle ${escapeHtml(
      String(cycle)
    )}] ${escapeHtml(summary)}`;
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
  currentRules = parsed.map((r) =>
    normalizeIncomingRule({ text: r, origin: "user", status: "pending" })
  );
  renderRules();

  appendChatMessage({
    sender: "system",
    text: "Governance rules submitted. All subsequent runs will enforce this configuration until you reset or change them.",
  });

  // Let the backend know about updated governance (optional).
  socket.emit("submit-governance", {
    goal: currentGoalText,
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

    socket.emit("reset-governance");
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
    socket.emit("reset-conversation");
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
      currentGovernanceObject = null;
      break;

    case "cycle-plan":
      // Currently used only for animation in prior design – no-op here.
      break;

    case "final-output":
      handleFinalOutput(payload);
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
      // Optional: log arbitration / escalation hints if present
      if (payload.arbitrationSummary) {
        appendModeratorLog(
          `Arbitration: ${payload.arbitrationSummary}`
        );
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

    // Optional meta-telemetry for advanced governance:
    // inferred rules, ignored rules, deltas, counters, escalations, etc.
    case "governance-meta":
      handleGovernanceMeta(payload);
      break;

    default:
      break;
  }
});

// ==============================
// FINAL OUTPUT HANDLER
// ==============================

function handleFinalOutput(payload) {
  isWorkflowRunning = false;
  setStatus("Final");

  // Backward compatible:
  // - Old style: payload = { type:"final-output", text:"..." }
  // - New style: payload = { type:"final-output", result:{ ...universal schema... } }

  let displayText = "No final text returned.";

  if (typeof payload === "string") {
    displayText = payload;
  } else if (payload && typeof payload === "object") {
    // Universal governance object support
    if (payload.result && typeof payload.result === "object") {
      currentGovernanceObject = payload.result;

      // Prefer FinalGovernedOutput if present
      if (
        typeof payload.result.FinalGovernedOutput === "string" &&
        payload.result.FinalGovernedOutput.trim().length > 0
      ) {
        displayText = payload.result.FinalGovernedOutput.trim();
      } else if (typeof payload.result.text === "string") {
        displayText = payload.result.text.trim();
      } else {
        displayText = JSON.stringify(payload.result, null, 2);
      }
    } else if (typeof payload.text === "string") {
      displayText = payload.text.trim();
    }
  }

  appendChatMessage({
    text: displayText,
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
// GOVERNANCE META HANDLER
// ==============================

function handleGovernanceMeta(payload) {
  // This is a flexible channel for advanced domain-agnostic behaviors:
  // - inferredRules
  // - ignoredRules
  // - conflicts
  // - deltas
  // - countersOrAlternatives
  // - escalations
  // - impactScores
  // - alignmentReasons
  // We primarily surface these via Moderator log + ledger enrichment.

  if (!payload) return;

  if (Array.isArray(payload.messages)) {
    payload.messages.forEach((m) => {
      if (m && m.channel === "moderator") {
        appendModeratorLog(m.text || "");
      } else if (m && m.channel === "analytical") {
        appendAnalyticalLog(m.text || "");
      } else if (m && m.channel === "creative") {
        appendCreativeLog(m.text || "");
      }
    });
  }

  if (Array.isArray(payload.updatedRules) && payload.updatedRules.length) {
    // Merge updated rule info into currentRules by id or text match.
    const byKey = (r) =>
      (r.id && String(r.id).toLowerCase()) ||
      (r.text && r.text.toLowerCase());

    const currentByKey = new Map();
    currentRules.forEach((r) => {
      currentByKey.set(byKey(r), r);
    });

    payload.updatedRules.forEach((uRaw) => {
      const u = normalizeIncomingRule(uRaw, "user");
      const key = byKey(u);
      if (!key) return;
      if (currentByKey.has(key)) {
        const existing = currentByKey.get(key);
        Object.assign(existing, u);
      } else {
        currentRules.push(u);
      }
    });

    renderRules();
  }
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
