const socket = io();

// DOM refs
const goalInputEl = document.getElementById("goal-input");
const runButtonEl = document.getElementById("run-button");
const runStatusEl = document.getElementById("run-status");

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

// Chat UI refs
const chatLogEl = document.getElementById("chat-log");
const chatInputEl = document.getElementById("chat-input");
const chatSendButtonEl = document.getElementById("chat-send-button");

// Sliders + perf mode
const strictnessSliderEl = document.getElementById("strictness-slider");
const cycleSliderEl = document.getElementById("cycle-slider");

// Animation + output gating state
let plannedCycles = 0;
let animationRunning = false;
let animationDone = false;
let pendingFinalText = null;

// Ledger state
let currentLedger = [];

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

// ---- Chat helpers -----------------------------------------------------------

function addChatSystemMessage(text) {
  if (!chatLogEl) return;
  const row = document.createElement("div");
  row.className = "chat-row chat-row-center";

  const span = document.createElement("div");
  span.className = "chat-system-message";
  span.textContent = text;

  row.appendChild(span);
  chatLogEl.appendChild(row);
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
}

function addChatMessage(role, text) {
  if (!chatLogEl || !text) return;

  let side = "right";
  let label = "";
  let avatarText = "";
  let extraBubbleClass = "";

  switch (role) {
    case "user":
      side = "left";
      label = "You";
      avatarText = "ML";
      break;
    case "final":
      side = "right";
      label = "Final Output";
      avatarText = "✔";
      extraBubbleClass = "chat-bubble-final";
      break;
    case "task":
      side = "right";
      label = "Task Agent";
      avatarText = "T";
      break;
    case "analytical":
      side = "right";
      label = "Analytical Hemisphere";
      avatarText = "A";
      break;
    case "moderator":
      side = "right";
      label = "Moderator";
      avatarText = "M";
      break;
    case "creative":
      side = "right";
      label = "Creative Hemisphere";
      avatarText = "C";
      break;
    case "validator":
      side = "right";
      label = "Validator";
      avatarText = "V";
      break;
    default:
      side = "right";
      label = "MCP";
      avatarText = "M";
      break;
  }

  const row = document.createElement("div");
  row.className = "chat-row " + (side === "left" ? "chat-row-left" : "chat-row-right");

  const avatar = document.createElement("div");
  avatar.className = "chat-avatar" + (role === "user" ? " chat-avatar-user" : "");
  avatar.textContent = avatarText;

  const wrapper = document.createElement("div");
  wrapper.className = "chat-bubble-wrapper";

  if (label) {
    const labelEl = document.createElement("div");
    labelEl.className = "chat-label";
    labelEl.textContent = label;
    wrapper.appendChild(labelEl);
  }

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble" + (extraBubbleClass ? " " + extraBubbleClass : "");
  bubble.innerText = text;
  wrapper.appendChild(bubble);

  if (side === "left") {
    row.appendChild(avatar);
    row.appendChild(wrapper);
  } else {
    row.appendChild(wrapper);
    row.appendChild(avatar);
  }

  chatLogEl.appendChild(row);
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
}

// main send function used by both chat-send and run-button
function sendTaskFromChat() {
  const inputText = chatInputEl ? chatInputEl.value.trim() : "";

  if (!inputText) {
    runStatusEl.textContent = "Please type a task in the chat first.";
    return;
  }

  // Append user message to chat
  addChatMessage("user", inputText);

  // Clear input box
  if (chatInputEl) chatInputEl.value = "";

  // Reset gating
  animationDone = false;
  animationRunning = false;
  pendingFinalText = null;

  const perfMode = getPerfMode();

  runStatusEl.textContent = `Running governed workflow (${perfMode.toUpperCase()} mode)…`;

  const payload = {
    input: inputText,
    goal: goalInputEl ? goalInputEl.value.trim() : "",
    maxCycles: getMaxCycles(),
    governanceStrictness: getGovernanceStrictness(),
    perfMode,
  };

  // Add a system note in the chat
  addChatSystemMessage(`MCP starting governed workflow in ${perfMode.toUpperCase()} mode…`);

  socket.emit("run-workflow", payload);
}

// --- Run button --------------------------------------------------------------

if (runButtonEl) {
  runButtonEl.addEventListener("click", () => {
    sendTaskFromChat();
  });
}

// Chat send button + Enter key
if (chatSendButtonEl) {
  chatSendButtonEl.addEventListener("click", () => {
    sendTaskFromChat();
  });
}

if (chatInputEl) {
  chatInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendTaskFromChat();
    }
  });
}

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
      // animation uses cycle-plan; nothing extra needed
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
  // Add final governed output as a green iMessage-style bubble
  addChatMessage("final", text || "No output returned.");
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
  } else if (status === "Validator") {
    pillClass = "pill pill-active-validator";
    pillText = "MCP: Validator";
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
  let basePerCycle;
  if (perf === "real") {
    basePerCycle = 380; // ms per half-cycle
  } else if (perf === "fast") {
    basePerCycle = 230;
  } else {
    basePerCycle = 140; // turbo
  }

  const steps = cycles * 2 + 1;
  const totalDuration = basePerCycle * steps;
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
