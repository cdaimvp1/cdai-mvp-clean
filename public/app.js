const socket = io();

// --- DOM refs ---------------------------------------------------------------

// Chat / conversation
const messageListEl = document.getElementById("message-list");
const chatInputEl = document.getElementById("chat-input");
const chatSendBtnEl = document.getElementById("chat-send");
const conversationResetBtnEl = document.getElementById("conversation-reset");
const runStatusEl = document.getElementById("run-status");

// Governance
const goalInputEl = document.getElementById("goal-input");
const governanceSubmitBtnEl = document.getElementById("governance-submit");
const governanceResetBtnEl = document.getElementById("governance-reset");
const rulesListEl = document.getElementById("rules-list");

// Header controls
const strictnessSliderEl = document.getElementById("strictness-slider");
const strictnessValueEl = document.getElementById("strictness-value");
const cycleSliderEl = document.getElementById("cycle-slider");
const cycleSliderValueEl = document.getElementById("cycle-slider-value");
const statusPillEl = document.getElementById("mcp-status-pill");
const cycleIndicatorEl = document.getElementById("cycle-indicator");
const logoutButtonEl = document.getElementById("logout-button");

// Logs
const analyticalLogEl = document.getElementById("analytical-log");
const creativeLogEl = document.getElementById("creative-log");
const moderatorLogEl = document.getElementById("moderator-log");
const ledgerLogEl = document.getElementById("ledger-log");
const collapsibleCards = document.querySelectorAll(".log-card");

// Ledger download
const downloadLedgerBtn = document.getElementById("download-ledger-btn");

// --- State -------------------------------------------------------------------

let governanceLocked = false;
let lockedGovernanceText = "";
let isRunning = false;

// Conversation mode: "task" or "clarification"
let chatMode = "task";
let activeClarificationCycle = null;

// Ledger state
let currentLedger = [];

// Governance rules UI state
let ruleState = [];

// --- Utility: header sliders & perf mode ------------------------------------

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

// Keep slider labels in sync
function initSliderLabels() {
  if (strictnessSliderEl && strictnessValueEl) {
    const updateStrictness = () => {
      strictnessValueEl.textContent = Number(
        strictnessSliderEl.value
      ).toFixed(2);
    };
    strictnessSliderEl.addEventListener("input", updateStrictness);
    updateStrictness();
  }

  if (cycleSliderEl && cycleSliderValueEl) {
    const updateCycles = () => {
      cycleSliderValueEl.textContent = cycleSliderEl.value;
    };
    cycleSliderEl.addEventListener("input", updateCycles);
    updateCycles();
  }
}

// --- Conversation helpers ---------------------------------------------------

function appendMessage({ from, text, meta, variant } = {}) {
  if (!messageListEl) return;
  const row = document.createElement("div");

  if (from === "user") {
    row.className = "message-row user";
  } else if (from === "system") {
    row.className = "message-row system";
  } else if (from === "center") {
    row.className = "message-row center";
  } else {
    row.className = "message-row system";
  }

  if (from === "center") {
    const p = document.createElement("div");
    p.className = "chat-system-message";
    p.textContent = text;
    row.appendChild(p);
  } else {
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";

    if (from === "user") {
      bubble.classList.add("bubble-user");
    } else {
      bubble.classList.add("bubble-system");
    }

    if (variant === "final") {
      bubble.classList.add("bubble-final");
    }

    const textEl = document.createElement("div");
    textEl.className = "message-text";
    textEl.textContent = text || "";

    bubble.appendChild(textEl);

    if (meta) {
      const metaEl = document.createElement("div");
      metaEl.className = "message-meta";
      metaEl.textContent = meta;
      bubble.appendChild(metaEl);
    }

    row.appendChild(bubble);
  }

  messageListEl.appendChild(row);
  messageListEl.scrollTop = messageListEl.scrollHeight;
}

function initConversation() {
  if (!messageListEl) return;
  messageListEl.innerHTML = "";
  appendMessage({
    from: "system",
    text:
      "Governance Conversation initialized. Submit governance rules, then send a task to run the governed workflow.",
    meta: formatDateTimeMeta(),
  });
}

// Chat input auto-resize like ChatGPT
function autoResizeChatInput() {
  if (!chatInputEl) return;
  chatInputEl.style.height = "auto";
  const max = 120; // match CSS
  const newHeight = Math.min(chatInputEl.scrollHeight, max);
  chatInputEl.style.height = `${newHeight}px`;
}

// --- Governance parsing on client (for display before first run) ------------

function parseRulesLocal(goalText) {
  if (!goalText) return [];
  return goalText
    .split(/\n|;/)
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
}

function renderParsedRulesFromText(goalText) {
  const rules = parseRulesLocal(goalText);
  initGovernanceRules(rules);
}

// --- Governance rules UI ----------------------------------------------------

function initGovernanceRules(rules) {
  if (!rulesListEl) return;
  rulesListEl.innerHTML = "";
  ruleState = (rules || []).map((ruleText) => ({
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

function markRulesProgress() {
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

// --- Status pill & cycle ----------------------------------------------------

function updateStatusPill(status, detail) {
  let label = "Status | Idle";
  let cls = "status-pill status-idle";

  const s = (status || "Idle").toString();

  if (s === "Starting") {
    label = "Status | Starting";
    cls = "status-pill status-idle";
  } else if (s === "Analytical Pass") {
    label = "Status | Analytical";
    cls = "status-pill status-analytical";
  } else if (s === "Creative Pass") {
    label = "Status | Creative";
    cls = "status-pill status-creative";
  } else if (s === "Moderator") {
    label = "Status | Moderator";
    cls = "status-pill status-moderator";
  } else if (s === "Finalized") {
    label = "Status | Final";
    cls = "status-pill status-final";
  } else if (s === "Error") {
    label = "Status | Error";
    cls = "status-pill status-error";
  }

  if (statusPillEl) {
    statusPillEl.className = cls;
    statusPillEl.textContent = label;
  }

  if (detail && runStatusEl) {
    runStatusEl.textContent = detail;
  }
}

// --- Logs -------------------------------------------------------------------

function appendHemisphereLog(hemisphere, message) {
  const entry = document.createElement("div");
  entry.className =
    "log-entry " + (hemisphere === "A" ? "analytical" : "creative");
  entry.innerHTML = `<span class="timestamp">${formatTimeStamp()}</span>${escapeHtml(
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

function appendModeratorLog(message) {
  if (!moderatorLogEl) return;
  const entry = document.createElement("div");
  entry.className = "log-entry moderator";
  entry.innerHTML = `<span class="timestamp">${formatTimeStamp()}</span>${escapeHtml(
    message
  )}`;
  moderatorLogEl.appendChild(entry);
  moderatorLogEl.scrollTop = moderatorLogEl.scrollHeight;
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

// --- Clarification handling via chat ----------------------------------------

function showClarificationRequest(payload) {
  const { question, confidence, cycle } = payload || {};
  activeClarificationCycle = cycle || 1;
  chatMode = "clarification";

  let meta = `MCP clarification • cycle ${activeClarificationCycle}`;
  if (typeof confidence === "number") {
    if (confidence >= 0.75) {
      meta += ` • confidence ${confidence.toFixed(2)} (high)`;
    } else if (confidence >= 0.45) {
      meta += ` • confidence ${confidence.toFixed(2)} (medium)`;
    } else {
      meta += ` • confidence ${confidence.toFixed(
        2
      )} (low – asking for clarification)`;
    }
  }

  appendMessage({
    from: "system",
    text:
      question ||
      "The MCP needs a brief clarification. Please restate your intent in 1–2 sentences.",
    meta,
  });

  if (runStatusEl) {
    runStatusEl.textContent =
      "MCP is waiting for your clarification before continuing this run.";
  }
}

// --- UI reset at start of a run (but keep conversation & governance) --------

function resetUIForNewRun() {
  if (runStatusEl) runStatusEl.textContent = "";
  if (analyticalLogEl) analyticalLogEl.innerHTML = "";
  if (creativeLogEl) creativeLogEl.innerHTML = "";
  if (ledgerLogEl) ledgerLogEl.innerHTML = "";
  if (moderatorLogEl) moderatorLogEl.innerHTML = "";
  if (rulesListEl) rulesListEl.innerHTML = "";

  currentLedger = [];

  if (cycleIndicatorEl) {
    cycleIndicatorEl.textContent = "Cycle: –";
  }

  // Do NOT clear conversation or governance text here.
  chatMode = "task";
  activeClarificationCycle = null;
}

// --- Handling final output ---------------------------------------------------

function handleFinalOutput(text) {
  appendMessage({
    from: "system",
    text: text || "",
    meta: formatDateTimeMeta() + " • Final governed output",
    variant: "final",
  });

  if (runStatusEl) {
    runStatusEl.textContent = "Governed workflow complete.";
  }
  isRunning = false;
}

// --- Download ledger --------------------------------------------------------

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

// --- Collapsible log panels --------------------------------------------------

collapsibleCards.forEach((card) => {
  const btn = card.querySelector(".chevron-btn");
  if (!btn) return;

  btn.addEventListener("click", () => {
    card.classList.toggle("collapsed");
  });
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

// --- Governance submit/reset -------------------------------------------------

if (governanceSubmitBtnEl) {
  governanceSubmitBtnEl.addEventListener("click", () => {
    if (isRunning) {
      if (runStatusEl) {
        runStatusEl.textContent =
          "Governance cannot be changed while a run is in progress.";
      }
      return;
    }

    const text = (goalInputEl?.value || "").trim();
    if (!text) {
      appendMessage({
        from: "system",
        text: "Please provide governance rules before submitting.",
        meta: formatDateTimeMeta(),
      });
      if (runStatusEl) {
        runStatusEl.textContent = "No governance rules provided.";
      }
      return;
    }

    governanceLocked = true;
    lockedGovernanceText = text;

    renderParsedRulesFromText(lockedGovernanceText);

    appendMessage({
      from: "system",
      text:
        "Governance rules submitted and locked. All subsequent tasks in this session will be governed by these constraints until you reset them.",
      meta: formatDateTimeMeta(),
    });

    if (runStatusEl) {
      runStatusEl.textContent =
        "Governance submitted. You may now send tasks in the chat.";
    }
  });
}

if (governanceResetBtnEl) {
  governanceResetBtnEl.addEventListener("click", () => {
    if (isRunning) {
      if (runStatusEl) {
        runStatusEl.textContent =
          "Cannot reset governance while a run is in progress.";
      }
      return;
    }

    governanceLocked = false;
    lockedGovernanceText = "";
    if (goalInputEl) goalInputEl.value = "";
    if (rulesListEl) rulesListEl.innerHTML = "";
    ruleState = [];

    appendMessage({
      from: "system",
      text:
        "Governance rules cleared. Submit a new set of rules before starting another governed run.",
      meta: formatDateTimeMeta(),
    });

    if (runStatusEl) {
      runStatusEl.textContent = "Governance cleared.";
    }
  });
}

// --- Conversation reset ------------------------------------------------------

if (conversationResetBtnEl) {
  conversationResetBtnEl.addEventListener("click", () => {
    if (isRunning) {
      if (runStatusEl) {
        runStatusEl.textContent =
          "Cannot reset conversation while a run is in progress.";
      }
      return;
    }
    initConversation();
  });
}

// --- Chat send ---------------------------------------------------------------

if (chatSendBtnEl) {
  chatSendBtnEl.addEventListener("click", () => {
    handleChatSubmit();
  });
}

if (chatInputEl) {
  chatInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleChatSubmit();
    }
  });

  chatInputEl.addEventListener("input", autoResizeChatInput);
}

// Main chat submission logic: sends either a task or clarification
function handleChatSubmit() {
  if (!chatInputEl) return;
  const text = chatInputEl.value.trim();
  if (!text) return;

  // Always show the user's bubble first
  appendMessage({
    from: "user",
    text,
    meta: formatDateTimeMeta(),
  });

  chatInputEl.value = "";
  autoResizeChatInput();

  // 1) If we are answering a clarification:
  if (chatMode === "clarification" && activeClarificationCycle != null) {
    socket.emit("clarification-response", {
      cycle: activeClarificationCycle,
      answer: text,
    });

    chatMode = "task";
    activeClarificationCycle = null;

    if (runStatusEl) {
      runStatusEl.textContent = "Clarification sent to MCP. Continuing run…";
    }

    appendMessage({
      from: "system",
      text: "Clarification received. The MCP is continuing this governed run.",
      meta: formatDateTimeMeta(),
    });
    return;
  }

  // 2) For tasks, we need governance locked
  if (!governanceLocked) {
    appendMessage({
      from: "system",
      text:
        "Please submit governance rules before sending tasks. Use the Goal / Governance Rules panel, then click Submit Governance.",
      meta: formatDateTimeMeta(),
    });
    if (runStatusEl) {
      runStatusEl.textContent =
        "Governance required before starting a governed run.";
    }
    return;
  }

  // 3) Do not queue tasks while a run is active
  if (isRunning) {
    appendMessage({
      from: "system",
      text:
        "A governed workflow is already running. Please wait until it completes before sending another task.",
      meta: formatDateTimeMeta(),
    });
    return;
  }

  // 4) Start a new governed workflow
  isRunning = true;
  if (runStatusEl) {
    runStatusEl.textContent = "Running governed workflow…";
  }

  const payload = {
    input: text,
    goal: lockedGovernanceText,
    maxCycles: getMaxCycles(),
    governanceStrictness: getGovernanceStrictness(),
    perfMode: getPerfMode(),
  };

  socket.emit("run-workflow", payload);
}

// --- Socket telemetry --------------------------------------------------------

socket.on("telemetry", (payload) => {
  switch (payload.type) {
    case "reset":
      resetUIForNewRun();
      break;

    case "cycle-plan":
      // We no longer animate visually, but we can show planned cycles if desired.
      if (cycleIndicatorEl && payload.plannedCycles) {
        cycleIndicatorEl.textContent = `Cycle: 1 / ${payload.plannedCycles}`;
      }
      break;

    case "cycle-update":
      if (cycleIndicatorEl && payload.cycle) {
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
      markRulesProgress();
      break;

    case "governance-rules-final":
      markRulesFinal();
      break;

    case "mcp-status":
      updateStatusPill(payload.status, payload.detail);
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

// --- Time / formatting helpers ----------------------------------------------

function formatDateTimeMeta() {
  const d = new Date();
  const date = d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
  const time = d.toLocaleTimeString([], { hour12: false });
  return `${date} • ${time}`;
}

function formatTimeStamp() {
  const d = new Date();
  const date = d.toISOString().slice(0, 10); // YYYY-MM-DD
  const time = d.toLocaleTimeString([], { hour12: false });
  return `${date} ${time}`;
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

// --- Init --------------------------------------------------------------------

initSliderLabels();
initConversation();
autoResizeChatInput();
