// =============================================================
// Socket.IO Connection with Reconnect Awareness
// =============================================================
const socket = io({
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 800,
});

socket.on("connect", () => {
  console.log("Connected to server.");
  appendSystemMessage("🟢 Reconnected to MCP.");
});

socket.on("disconnect", () => {
  appendSystemMessage("🔴 Connection lost. Attempting reconnect…");
});

// =============================================================
// DOM REFERENCES
// =============================================================

// Chat
const chatInputEl = document.getElementById("chat-input");
const chatSendButtonEl = document.getElementById("chat-send-button");
const chatHistoryEl = document.getElementById("chat-history");
const chatResetButtonEl = document.getElementById("chat-reset-button");

const rulesListEl = document.getElementById("rules-list");

// Logs
const analyticalLogEl = document.getElementById("analytical-log");
const moderatorLogEl = document.getElementById("moderator-log");
const creativeLogEl = document.getElementById("creative-log");
const ledgerLogEl = document.getElementById("ledger-log");

// Controls
const strictnessSliderEl = document.getElementById("strictness-slider");
const strictnessValueEl = document.getElementById("strictness-value");
const cycleSliderEl = document.getElementById("cycle-slider");
const cycleValueEl = document.getElementById("cycle-value");
const modeRealBtn = document.getElementById("mode-real");
const modeFastBtn = document.getElementById("mode-fast");
const modeTurboBtn = document.getElementById("mode-turbo");
const logoutButtonEl = document.getElementById("logout-button");
const clearRulesButtonEl = document.getElementById("clear-rules-button");
const gilIndicatorEl = document.getElementById("gil-indicator");

// Status
const statusLabelDynamic = document.getElementById("status-label-dynamic");

// Ledger Download
const ledgerDownloadBtn = document.getElementById("download-ledger-btn");

// Summary block (Parsed Governance Rules)
const rulesSummaryEl = document.getElementById("rules-summary");

// =============================================================
// STATE
// =============================================================
let currentPerfMode = "real";
let latestLedger = [];
let sendCooldown = false;
let gilStateActive = false;
let lastRules = [];
let pendingTaskText = null;
let rulesFinalized = false;
const chatInputMinHeight = 80;
const chatInputMaxHeight = 160;

// =============================================================
// HELPERS
// =============================================================

function animatedScroll(container) {
  if (!container) return;
  container.scrollTo({
    top: container.scrollHeight,
    behavior: "smooth",
  });
}

function appendMessage(text, className) {
  if (!chatHistoryEl) return;

  const div = document.createElement("div");
  div.className = className;
  div.textContent = text;

  div.style.opacity = 0;
  div.style.transition = "opacity 0.25s ease";

  chatHistoryEl.appendChild(div);
  animatedScroll(chatHistoryEl);

  requestAnimationFrame(() => (div.style.opacity = 1));
}

function appendUserMessage(text) {
  appendMessage(text, "chat-message user");
}

function appendSystemMessage(text) {
  appendMessage(text, "chat-message system");
}

function appendFinalMessage(text) {
  appendMessage(text, "chat-message final");
}

function addLog(container, msg, cssClass) {
  if (!container) return;

  const div = document.createElement("div");
  div.className = `log-entry ${cssClass}`;
  div.textContent = msg;

  div.style.opacity = 0;
  div.style.transition = "opacity 0.25s ease";

  container.appendChild(div);
  animatedScroll(container);

  requestAnimationFrame(() => (div.style.opacity = 1));
}

function clearLogs() {
  if (analyticalLogEl) analyticalLogEl.innerHTML = "";
  if (moderatorLogEl) moderatorLogEl.innerHTML = "";
  if (creativeLogEl) creativeLogEl.innerHTML = "";
  if (ledgerLogEl) ledgerLogEl.innerHTML = "";
}

// =============================================================
// SEND MESSAGE
// =============================================================
function sendUserMessage(text) {
  if (sendCooldown) return;

  sendCooldown = true;
  setTimeout(() => (sendCooldown = false), 300);

  appendUserMessage(text);

  pendingTaskText = text;
  const isRuleMessage = /rule:|add rule|governance:|constraints:|the following rules/i.test(text);
  const mode = isRuleMessage ? "rules" : "task";
  socket.emit("run-workflow", {
    input: text,
    mode,
    goal: "", // rules are managed server-side
    maxCycles:
      Number(cycleSliderEl?.value || 0) === 0
        ? null
        : Number(cycleSliderEl?.value || 0),
    governanceStrictness: Number(strictnessSliderEl?.value || 0.85),
    perfMode: currentPerfMode,
  });

  if (chatInputEl) chatInputEl.value = "";
}

// Autosize chat input like iOS: expand up to a max, then scroll.
function autosizeChatInput() {
  if (!chatInputEl) return;
  chatInputEl.style.height = "auto";
  const newHeight = Math.min(
    chatInputMaxHeight,
    Math.max(chatInputMinHeight, chatInputEl.scrollHeight)
  );
  chatInputEl.style.height = `${newHeight}px`;
  chatInputEl.style.overflowY =
    chatInputEl.scrollHeight > chatInputMaxHeight ? "auto" : "hidden";
}

// =============================================================
// EVENT LISTENERS
// =============================================================

// Send
chatSendButtonEl?.addEventListener("click", () => {
  const text = chatInputEl.value.trim();
  if (text) sendUserMessage(text);
});

chatInputEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    const text = chatInputEl.value.trim();
    if (text) sendUserMessage(text);
  }
});

chatInputEl?.addEventListener("input", autosizeChatInput);

// Reset conversation
chatResetButtonEl?.addEventListener("click", () => {
  if (chatHistoryEl) chatHistoryEl.innerHTML = "";
  socket.emit("reset-conversation");
  gilStateActive = false;
  updateGilIndicator();
});

// Logout
logoutButtonEl?.addEventListener("click", async () => {
  try {
    await fetch("/auth/logout", { method: "POST" });
  } catch (e) {
    console.error("Logout error", e);
  } finally {
    window.location.href = "/login";
  }
});

clearRulesButtonEl?.addEventListener("click", async () => {
  try {
    const resp = await fetch("/clear-rules", { method: "POST" });
    if (resp.ok) {
      appendSystemMessage("All governance rules have been cleared.");
      if (rulesListEl) rulesListEl.innerHTML = "";
      if (rulesSummaryEl) rulesSummaryEl.textContent = "";
      lastRules = [];
      rulesFinalized = false;
    } else {
      appendSystemMessage("Unable to clear governance rules right now.");
    }
  } catch (err) {
    console.error("Clear rules error", err);
    appendSystemMessage("Error clearing governance rules.");
  }
});

// =============================================================
// SLIDERS & MODES
// =============================================================
function updateStrictnessLabel() {
  if (strictnessValueEl && strictnessSliderEl) {
    const val = Number(strictnessSliderEl.value || 0).toFixed(2);
    strictnessValueEl.textContent = val;
  }
}

function updateCycleLabel() {
  if (cycleValueEl && cycleSliderEl) {
    const val = Number(cycleSliderEl.value || 0);
    cycleValueEl.textContent = val === 0 ? "OFF" : String(val);
  }
}

function updateGilIndicator() {
  if (gilIndicatorEl) {
    gilIndicatorEl.classList.toggle("gil-on", gilStateActive);
  }
}

strictnessSliderEl?.addEventListener("input", () => {
  updateStrictnessLabel();
});

cycleSliderEl?.addEventListener("input", () => {
  updateCycleLabel();
  updateGilIndicator();
});

function setMode(mode) {
  currentPerfMode = mode;

  modeRealBtn?.classList.remove("active");
  modeFastBtn?.classList.remove("active");
  modeTurboBtn?.classList.remove("active");

  if (mode === "real") modeRealBtn?.classList.add("active");
  if (mode === "fast") modeFastBtn?.classList.add("active");
  if (mode === "turbo") modeTurboBtn?.classList.add("active");
  updateGilIndicator();
}

modeRealBtn?.addEventListener("click", () => setMode("real"));
modeFastBtn?.addEventListener("click", () => setMode("fast"));
modeTurboBtn?.addEventListener("click", () => setMode("turbo"));

// Initialize slider labels and indicator on load
updateStrictnessLabel();
updateCycleLabel();
updateGilIndicator();
autosizeChatInput();

// =============================================================
// LEDGER DOWNLOAD
// =============================================================
ledgerDownloadBtn?.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(latestLedger, null, 2)], {
    type: "application/json",
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = "cdai_ledger.json";
  a.click();

  URL.revokeObjectURL(url);
});

// =============================================================
// SOCKET TELEMETRY
// =============================================================
socket.on("telemetry", (msg) => {
  switch (msg.type) {
    case "reset":
      clearLogs();
      break;

    case "mcp-status":
      if (statusLabelDynamic) {
        statusLabelDynamic.textContent = msg.status;
        statusLabelDynamic.className =
          "status-label-dynamic status-" + String(msg.status || "").toLowerCase();
      }
      break;

    // ---------------------------------------------------------
    // GOVERNANCE RULES + SUMMARY
    // ---------------------------------------------------------
case "governance-rules":
    case "governance-rules-final": {
      if (!rulesListEl) break;

      const rules = Array.isArray(msg.rules) ? msg.rules : lastRules;
      lastRules = rules;
      if (msg.rulesFinalized !== undefined) {
        rulesFinalized = !!msg.rulesFinalized;
      }

      rulesListEl.innerHTML = "";

      let counts = { passed: 0, failed: 0, clarified: 0, pending: 0, total: rules.length };

      rules.forEach((ruleObj, index) => {
        const li = document.createElement("li");
        li.className = "rule-item";
        li.dataset.index = index;

        const isStringRule = typeof ruleObj === "string";

        const text = isStringRule ? ruleObj : ruleObj.text || "";
        const origin = isStringRule ? "user" : ruleObj.origin || "user";
        const statusRaw = isStringRule ? null : ruleObj.status;
        const status =
          statusRaw === "passed" || statusRaw === "failed" || statusRaw === "clarified"
            ? statusRaw
            : statusRaw === "user-clarified"
            ? "clarified"
            : "unknown";

        if (status === "passed") counts.passed += 1;
        else if (status === "failed") counts.failed += 1;
        else if (status === "clarified") counts.clarified += 1;
        else counts.pending += 1;

        const statusIcon =
          status === "passed"
            ? "✓"
            : status === "failed"
            ? "✕"
            : status === "clarified"
            ? "⚠"
            : "•";
        const statusClass =
          status === "passed"
            ? "rule-status-passed"
            : status === "failed"
            ? "rule-status-failed"
            : status === "clarified"
            ? "rule-status-pending"
            : "rule-status-unknown";

        // Color logic
        let color = "#ffffff";
        if (status === "passed") color = "#6effa6"; // green
        else if (status === "failed") color = "#ff6b81"; // red
        else if (origin === "system") color = "#00aaff"; // blue
        else if (origin === "user-clarified") color = "#ffd479"; // amber

        li.style.color = color;

        const statusLabel =
          status && status !== "unknown" ? `:${status}` : "";

        li.innerHTML = `
          <span class="rule-status-icon ${statusClass}">${statusIcon}</span>
          <span class="rule-index">${index + 1}.</span>
          <span class="rule-text">${text}</span>
          <span class="rule-origin">[${origin}${statusLabel}]</span>
        `;

        rulesListEl.appendChild(li);
      });

      // ---- Summary block -----------------
      if (rulesSummaryEl) {
        rulesSummaryEl.innerHTML = `
          <div class="summary-title">Governance Compliance Summary</div>

          <div class="summary-row summary-pass">
            ✔ ${counts.passed} passed
          </div>
          <div class="summary-row summary-clarified">
            ⚠ ${counts.clarified} required clarification
          </div>
          <div class="summary-row summary-fail">
            ✖ ${counts.failed} failed
          </div>
          <div class="summary-row" style="color:#888;">
            • ${counts.pending} pending
          </div>

          <div style="margin-top:6px; opacity:0.7;">
            Total rules: ${counts.total}
          </div>
        `;
      }

      break;
    }

    case "hemisphere-log":
      if (msg.hemisphere === "A") {
        addLog(analyticalLogEl, msg.message, "analytical");
      } else {
        addLog(creativeLogEl, msg.message, "creative");
      }
      break;

    case "moderator-log":
      addLog(moderatorLogEl, msg.message, "moderator");
      break;

    case "ledger":
      latestLedger = msg.entries || [];
      if (ledgerLogEl) ledgerLogEl.innerHTML = "";
      latestLedger.forEach((entry) => {
        addLog(
          ledgerLogEl,
          `[${entry.timestamp}] (${entry.stage} – cycle ${entry.cycle}) ${entry.summary}`,
          "ledger"
        );
      });
      break;

    case "final-output":
      {
        const showFinal =
          msg.text && (!msg.narrative || msg.text !== msg.narrative);
        if (showFinal) appendFinalMessage(msg.text);
        if (msg.narrative) {
          appendSystemMessage(msg.narrative);
        } else {
          console.warn("Missing narrative in final-output telemetry.");
        }
      }
      break;
    case "governance-response":
      if (msg.text) appendSystemMessage(msg.text);
      break;

    case "clarification-request":
      appendSystemMessage("⚠️ Clarification required:\n" + msg.question);
      break;

    case "gil-state":
      {
        const dot = document.getElementById("gil-indicator");
        gilStateActive = !!msg.active;
        updateGilIndicator();
      }
      break;

    default:
      console.warn("Unknown telemetry:", msg);
  }
});
