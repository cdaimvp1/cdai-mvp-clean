const socket = io();

// DOM refs
const taskInputEl = document.getElementById("task-input");
const goalInputEl = document.getElementById("goal-input");
const runButtonEl = document.getElementById("run-button");
const runStatusEl = document.getElementById("run-status");
const finalOutputEl = document.getElementById("final-output");

const rulesListEl = document.getElementById("rules-list");
const cycleIndicatorEl = document.getElementById("cycle-indicator");
const mcpStatusPillEl = document.getElementById("mcp-status-pill");
const mcpDetailEl = document.getElementById("mcp-detail");

const flowPanelEl = document.querySelector(".flow-visual");
const nodeAEl = document.getElementById("node-a");
const nodeBEl = document.getElementById("node-b");
const nodeFinalEl = document.getElementById("node-final");

const analyticalLogEl = document.getElementById("analytical-log");
const creativeLogEl = document.getElementById("creative-log");
const moderatorLogEl = document.getElementById("moderator-log");
const ledgerLogEl = document.getElementById("ledger-log");

const collapsibleCards = document.querySelectorAll(".log-card");
const downloadLedgerBtn = document.getElementById("download-ledger-btn");
const logoutButtonEl = document.getElementById("logout-button");

// sliders + perf mode
const strictnessSliderEl = document.getElementById("strictness-slider");
const cycleSliderEl = document.getElementById("cycle-slider");

// MCP ↔ user clarification panel
const clarificationPanelEl = document.getElementById("clarification-panel");
const clarificationQuestionEl = document.getElementById("clarification-question");
const clarificationConfidenceEl = document.getElementById(
  "clarification-confidence"
);
const clarificationInputEl = document.getElementById("clarification-input");
const clarificationSendBtnEl = document.getElementById("clarification-send");

// Animation + output gating state
let plannedCycles = 0;
let animationRunning = false;
let animationDone = false;
let pendingFinalText = null;

// Ledger state
let currentLedger = [];

// Clarification state
let activeClarificationCycle = null;

// ---- Helpers to read controls ----------------------------------------------

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
  const radios = document.querySelectorAll("input[name='perf-mode']");
  for (const r of radios) {
    if (r.checked) return r.value || "real";
  }
  return "real";
}

// --- Run button --------------------------------------------------------------

runButtonEl.addEventListener("click", () => {
  const input = taskInputEl.value.trim();
  const goal = goalInputEl.value.trim();

  if (!input) {
    runStatusEl.textContent = "Please enter a task input.";
    return;
  }

  // Reset gating
  animationDone = false;
  animationRunning = false;
  pendingFinalText = null;

  runStatusEl.textContent = "Running governed workflow…";

  const payload = {
    input,
    goal,
    maxCycles: getMaxCycles(),
    governanceStrictness: getGovernanceStrictness(),
    perfMode: getPerfMode(),
  };

  socket.emit("run-workflow", payload);
});

// --- Logout ------------------------------------------------------------------

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

// --- Collapsible panels ------------------------------------------------------

collapsibleCards.forEach((card) => {
  const btn = card.querySelector(".chevron-btn");
  if (!btn) return;

  btn.addEventListener("click", () => {
    card.classList.toggle("collapsed");
  });
});

// --- Download ledger ---------------------------------------------------------

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

// --- Clarification send ------------------------------------------------------

if (clarificationSendBtnEl && clarificationInputEl) {
  clarificationSendBtnEl.addEventListener("click", () => {
    if (!activeClarificationCycle) return;

    const answer = clarificationInputEl.value.trim();
    // Send even if empty to allow MCP to continue
    socket.emit("clarification-response", {
      cycle: activeClarificationCycle,
      answer,
    });

    clarificationSendBtnEl.disabled = true;
    clarificationSendBtnEl.textContent = "Sent to MCP";
  });
}

// --- Socket telemetry --------------------------------------------------------

socket.on("telemetry", (payload) => {
  switch (payload.type) {
    case "reset":
      resetUI();
      break;
    case "cycle-plan":
      handleCyclePlan(payload.plannedCycles);
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
    case "cycle-update":
      // animation uses cycle-plan; nothing extra needed
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

// --- Helpers -----------------------------------------------------------------

function resetUI() {
  runStatusEl.textContent = "";
  finalOutputEl.textContent = "";
  analyticalLogEl.innerHTML = "";
  creativeLogEl.innerHTML = "";
  ledgerLogEl.innerHTML = "";
  if (moderatorLogEl) moderatorLogEl.innerHTML = "";
  rulesListEl.innerHTML = "";
  currentLedger = [];

  cycleIndicatorEl.textContent = "Cycle: –";
  mcpStatusPillEl.textContent = "MCP: Idle";
  mcpStatusPillEl.className = "pill pill-idle";
  mcpDetailEl.textContent = "Waiting to start governed workflow…";

  nodeAEl.classList.remove("active");
  nodeBEl.classList.remove("active");
  nodeFinalEl.classList.remove("active");
  flowPanelEl.classList.remove("anim-a", "anim-b", "anim-final");

  animationRunning = false;
  animationDone = false;
  pendingFinalText = null;

  // Reset clarification panel
  activeClarificationCycle = null;
  if (clarificationQuestionEl) {
    clarificationQuestionEl.textContent =
      "No clarification requested yet for this run.";
  }
  if (clarificationConfidenceEl) {
    clarificationConfidenceEl.textContent = "";
  }
  if (clarificationInputEl) {
    clarificationInputEl.value = "";
  }
  if (clarificationSendBtnEl) {
    clarificationSendBtnEl.disabled = true;
    clarificationSendBtnEl.textContent = "Send Response to MCP";
  }
}

function handleCyclePlan(planned) {
  plannedCycles = Math.max(1, planned || 1);
  startFlowAnimation(plannedCycles);
}

function handleFinalOutput(text) {
  if (animationDone) {
    showFinalOutput(text);
  } else {
    pendingFinalText = text;
  }
}

function showFinalOutput(text) {
  // preserve formatting; CSS uses white-space: pre-wrap;
  finalOutputEl.innerText = text || "";
  runStatusEl.textContent = "Governed workflow complete.";
}

// Governance rules UI

let ruleState = [];

function initGovernanceRules(rules) {
  rulesListEl.innerHTML = "";
  ruleState = rules.map((ruleText) => ({
    text: ruleText,
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

function markRulesProgress(cycle) {
  ruleState.forEach((rule, index) => {
    const li = rulesListEl.querySelector(`li[data-index="${index}"]`);
    if (!li) return;
    const dot = li.querySelector(".rule-status-dot");

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
  ruleState.forEach((rule, index) => {
    rule.status = "passed";
    const li = rulesListEl.querySelector(`li[data-index="${index}"]`);
    if (!li) return;
    const dot = li.querySelector(".rule-status-dot");
    dot.className = "rule-status-dot passed";
  });
}

// MCP status

function updateMcpStatus(status, detail) {
  let pillClass = "pill pill-idle";
  let pillText = "MCP: Idle";

  if (status === "Starting") {
    pillClass = "pill pill-idle";
    pillText = "MCP: Starting";
  } else if (status === "Analytical Pass") {
    pillClass = "pill pill-active-analytical";
    pillText = "MCP: Analytical Pass";
  } else if (status === "Moderator") {
    pillClass = "pill pill-active-moderator";
    pillText = "MCP: Moderator";
  } else if (status === "Creative Pass") {
    pillClass = "pill pill-active-creative";
    pillText = "MCP: Creative Pass";
  } else if (status === "Finalized") {
    pillClass = "pill pill-finalized";
    pillText = "MCP: Finalized";
  } else if (status === "Error") {
    pillClass = "pill pill-idle";
    pillText = "MCP: Error";
  }

  mcpStatusPillEl.className = pillClass;
  mcpStatusPillEl.textContent = pillText;

  if (detail) {
    mcpDetailEl.textContent = detail;
  }
}

// Hemisphere logs

function appendHemisphereLog(hemisphere, message) {
  const entry = document.createElement("div");
  entry.className =
    "log-entry " + (hemisphere === "A" ? "analytical" : "creative");
  entry.innerHTML = `<span class="timestamp">${timestamp()}</span>${escapeHtml(
    message
  )}`;

  if (hemisphere === "A") {
    analyticalLogEl.appendChild(entry);
    analyticalLogEl.scrollTop = analyticalLogEl.scrollHeight;
  } else {
    creativeLogEl.appendChild(entry);
    creativeLogEl.scrollTop = creativeLogEl.scrollHeight;
  }
}

// Moderator logs

function appendModeratorLog(message) {
  if (!moderatorLogEl) return;
  const entry = document.createElement("div");
  entry.className = "log-entry moderator";
  entry.innerHTML = `<span class="timestamp">${timestamp()}</span>${escapeHtml(
    message
  )}`;
  moderatorLogEl.appendChild(entry);
  moderatorLogEl.scrollTop = moderatorLogEl.scrollHeight;
}

// Clarification panel

function showClarificationRequest(payload) {
  const { question, confidence, cycle } = payload || {};
  activeClarificationCycle = cycle || 1;

  if (clarificationQuestionEl) {
    clarificationQuestionEl.textContent =
      question ||
      "The MCP has requested a brief clarification. Please provide 1–2 sentences so it can proceed.";
  }

  if (clarificationConfidenceEl) {
    if (typeof confidence === "number") {
      let label = "Model confidence: ";
      if (confidence >= 0.75) {
        label += `${confidence.toFixed(2)} (high)`;
      } else if (confidence >= 0.45) {
        label += `${confidence.toFixed(2)} (medium)`;
      } else {
        label += `${confidence.toFixed(2)} (low – asking for clarification)`;
      }
      clarificationConfidenceEl.textContent = label;
    } else {
      clarificationConfidenceEl.textContent = "";
    }
  }

  if (clarificationInputEl) {
    clarificationInputEl.value = "";
    clarificationInputEl.focus();
  }
  if (clarificationSendBtnEl) {
    clarificationSendBtnEl.disabled = false;
    clarificationSendBtnEl.textContent = "Send Response to MCP";
  }
}

// Ledger

function updateLedger(entries) {
  currentLedger = entries.slice();
  ledgerLogEl.innerHTML = "";

  currentLedger.forEach((e) => {
    const div = document.createElement("div");
    div.className = "log-entry ledger";
    div.innerHTML = `<span class="timestamp">${escapeHtml(
      e.timestamp
    )}</span>[${escapeHtml(e.stage)} – cycle ${e.cycle}] ${escapeHtml(
      e.summary
    )}`;
    ledgerLogEl.appendChild(div);
  });

  ledgerLogEl.scrollTop = ledgerLogEl.scrollHeight;
}

// Flow animation

function startFlowAnimation(planned) {
  const cycles = Math.max(1, planned || 1);

  // Animation speed varies with performance mode
  const perf = getPerfMode();
  let basePerHalfCycle;
  if (perf === "real") {
    basePerHalfCycle = 380; // ms per half-cycle
  } else if (perf === "fast") {
    basePerHalfCycle = 230;
  } else {
    basePerHalfCycle = 140; // turbo
  }

  const steps = cycles * 2 + 1;
  const totalDuration = basePerHalfCycle * steps;
  const stepDuration = totalDuration / steps;

  animationRunning = true;
  animationDone = false;

  nodeAEl.classList.remove("active");
  nodeBEl.classList.remove("active");
  nodeFinalEl.classList.remove("active");
  flowPanelEl.classList.remove("anim-a", "anim-b", "anim-final");

  for (let cycle = 1; cycle <= cycles; cycle++) {
    const stepIndexA = (cycle - 1) * 2;
    const timeA = stepIndexA * stepDuration;

    setTimeout(() => {
      highlightAnimationState("A", cycle);
    }, timeA);

    const stepIndexB = stepIndexA + 1;
    const timeB = stepIndexB * stepDuration;

    setTimeout(() => {
      highlightAnimationState("B", cycle);
    }, timeB);
  }

  const finalTime = cycles * 2 * stepDuration;

  setTimeout(() => {
    highlightAnimationState("FINAL", cycles);
    animationRunning = false;
    animationDone = true;

    if (pendingFinalText !== null) {
      showFinalOutput(pendingFinalText);
      pendingFinalText = null;
    }
  }, finalTime);
}

function highlightAnimationState(state, cycle) {
  nodeAEl.classList.remove("active");
  nodeBEl.classList.remove("active");
  nodeFinalEl.classList.remove("active");
  flowPanelEl.classList.remove("anim-a", "anim-b", "anim-final");

  if (state === "A") {
    nodeAEl.classList.add("active");
    flowPanelEl.classList.add("anim-a");
  } else if (state === "B") {
    nodeBEl.classList.add("active");
    flowPanelEl.classList.add("anim-b");
  } else if (state === "FINAL") {
    nodeFinalEl.classList.add("active");
    flowPanelEl.classList.add("anim-final");
  }

  if (state === "A" || state === "B") {
    cycleIndicatorEl.textContent = `Cycle: ${cycle}`;
  }
}

// Utility

function timestamp() {
  const d = new Date();
  return d.toLocaleTimeString([], { hour12: false });
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
