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
const ledgerLogEl = document.getElementById("ledger-log");

const collapsibleCards = document.querySelectorAll(".log-card");
const downloadLedgerBtn = document.getElementById("download-ledger-btn");
const logoutButtonEl = document.getElementById("logout-button");
const perfModeInputs = document.querySelectorAll('input[name="perf-mode"]');
const strictnessSliderEl = document.getElementById("strictness-slider");
const cycleSliderEl = document.getElementById("cycle-slider");

// Animation + output gating state
let plannedCycles = 0;
let animationRunning = false;
let animationDone = false;
let pendingFinalText = null;
let currentPerfMode = "real";

// Ledger state
let currentLedger = [];

// --- Helpers for perf mode ---------------------------------------------------

function getSelectedPerfMode() {
  for (const input of perfModeInputs) {
    if (input.checked) return input.value;
  }
  return "real";
}

function perfModeLabel(mode) {
  if (mode === "fast") return "Fast";
  if (mode === "turbo") return "Turbo";
  return "Real";
}

// --- Run button --------------------------------------------------------------

runButtonEl.addEventListener("click", () => {
  const input = taskInputEl.value.trim();
  const goal = goalInputEl.value.trim();

  if (!input) {
    runStatusEl.textContent = "Please enter a task input.";
    return;
  }

  const maxCycles = Number(cycleSliderEl?.value || 5);
  const governanceStrictness = Number(strictnessSliderEl?.value || 0.85);
  const mode = getSelectedPerfMode();
  currentPerfMode = mode;

  // Reset gating
  animationDone = false;
  animationRunning = false;
  pendingFinalText = null;

  runStatusEl.textContent = `Running governed workflow in ${perfModeLabel(
    mode
  )} mode…`;

  const payload = {
    input,
    goal,
    maxCycles,
    governanceStrictness,
    mode,
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
      // animation handles visual cycle
      break;
    case "hemisphere-log":
      appendHemisphereLog(payload.hemisphere, payload.message);
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
  finalOutputEl.textContent = text;
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
  entry.className = "log-entry " + (hemisphere === "A" ? "analytical" : "creative");
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

// Ledger

function updateLedger(entries) {
  currentLedger = entries.slice();
  ledgerLogEl.innerHTML = "";

  currentLedger.forEach((e) => {
    const div = document.createElement("div");
    div.className = "log-entry ledger";
    div.innerHTML = `<span class="timestamp">${escapeHtml(
      e.timestamp
    )}</span>[${escapeHtml(e.stage)} – cycle ${
      e.cycle
    }] ${escapeHtml(e.summary)}`;
    ledgerLogEl.appendChild(div);
  });

  ledgerLogEl.scrollTop = ledgerLogEl.scrollHeight;
}

// Flow animation

function startFlowAnimation(planned) {
  const cycles = Math.max(1, planned || 1);

  // Speed based on performance mode
  let totalDuration;
  if (currentPerfMode === "fast") {
    totalDuration = 1400;
  } else if (currentPerfMode === "turbo") {
    totalDuration = 700;
  } else {
    totalDuration = 2200;
  }

  const steps = cycles * 2 + 1;
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
