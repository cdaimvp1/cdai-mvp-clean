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

// Governance Rules
const goalInputEl = document.getElementById("goal-input");
const goalSubmitButtonEl = document.getElementById("goal-submit-button");
const goalResetButtonEl = document.getElementById("goal-reset-button");
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

// Status
const statusLabelDynamic = document.getElementById("status-label-dynamic");

// Ledger Download
const ledgerDownloadBtn = document.getElementById("download-ledger-btn");

// =============================================================
// STATE
// =============================================================
let currentPerfMode = "real";
let latestLedger = [];
let sendCooldown = false;

// =============================================================
// HELPERS
// =============================================================

function animatedScroll(container) {
  container.scrollTo({
    top: container.scrollHeight,
    behavior: "smooth",
  });
}

function appendMessage(text, className) {
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
  analyticalLogEl.innerHTML = "";
  moderatorLogEl.innerHTML = "";
  creativeLogEl.innerHTML = "";
  ledgerLogEl.innerHTML = "";
}

// =============================================================
// SEND MESSAGE
// =============================================================
function sendUserMessage(text) {
  if (sendCooldown) return;

  sendCooldown = true;
  setTimeout(() => (sendCooldown = false), 300);

  appendUserMessage(text);

  socket.emit("run-workflow", {
    input: text,
    goal: goalInputEl.value.trim(),
    maxCycles: Number(cycleSliderEl.value),
    governanceStrictness: Number(strictnessSliderEl.value),
    perfMode: currentPerfMode,
  });

  chatInputEl.value = "";
}

// =============================================================
// EVENT LISTENERS
// =============================================================

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

// Reset conversation
chatResetButtonEl?.addEventListener("click", () => {
  chatHistoryEl.innerHTML = "";
  socket.emit("reset-conversation");
});

// Governance submission
goalSubmitButtonEl?.addEventListener("click", () => {
  socket.emit("submit-governance", {
    goal: goalInputEl.value.trim(),
  });
});

// Governance reset
goalResetButtonEl?.addEventListener("click", () => {
  goalInputEl.value = "";
  rulesListEl.innerHTML = "";
  socket.emit("reset-governance");
});

// Logout
logoutButtonEl?.addEventListener("click", async () => {
  await fetch("/auth/logout", { method: "POST" });
  window.location.href = "/login";
});

// =============================================================
// SLIDERS & MODES
// =============================================================
strictnessSliderEl?.addEventListener("input", () => {
  strictnessValueEl.textContent = strictnessSliderEl.value;
});

cycleSliderEl?.addEventListener("input", () => {
  cycleValueEl.textContent = cycleSliderEl.value;
});

function setMode(mode) {
  currentPerfMode = mode;

  modeRealBtn.classList.remove("active");
  modeFastBtn.classList.remove("active");
  modeTurboBtn.classList.remove("active");

  if (mode === "real") modeRealBtn.classList.add("active");
  if (mode === "fast") modeFastBtn.classList.add("active");
  if (mode === "turbo") modeTurboBtn.classList.add("active");
}

modeRealBtn?.addEventListener("click", () => setMode("real"));
modeFastBtn?.addEventListener("click", () => setMode("fast"));
modeTurboBtn?.addEventListener("click", () => setMode("turbo"));

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
      statusLabelDynamic.textContent = msg.status;
      statusLabelDynamic.className =
        "status-label-dynamic status-" + msg.status.toLowerCase();
      break;

    // =========================================================
    // FIXED GOVERNANCE RULE RENDERING (object-aware)
    // =========================================================
case "governance-rules":
  rulesListEl.innerHTML = "";

  const summary = msg.summary || {
    passed: 0,
    failed: 0,
    clarified: 0,
    total: msg.rules.length || 0,
  };

  msg.rules.forEach((ruleObj, index) => {
    const li = document.createElement("li");
    li.className = "rule-item";
    li.dataset.index = index;

    const text = ruleObj.text || ruleObj;
    const origin = ruleObj.origin || "user";

    if (origin === "system") li.style.color = "#00aaff";
    else if (origin === "user-clarified") li.style.color = "#ffd479";
    else if (origin === "failed") li.style.color = "#ff6b81";
    else li.style.color = "#ffffff";

    li.innerHTML = `
      <span class="rule-index">${index + 1}.</span>
      <span class="rule-text">${text}</span>
      <span class="rule-origin">[${origin}]</span>
    `;

    rulesListEl.appendChild(li);
  });

  const summaryEl = document.getElementById("rules-summary");

  summaryEl.innerHTML = `
    <div class="summary-title">Governance Compliance Summary</div>

    <div class="summary-pass"   data-target="passed">✔ ${summary.passed} passed</div>
    <div class="summary-clarified" data-target="clarified">⚠ ${summary.clarified} required clarification</div>
    <div class="summary-fail"   data-target="failed">✖ ${summary.failed} failed</div>

    <div style="margin-top:6px; opacity:0.7;">
      Total rules: ${summary.total}
    </div>
  `;

  // ------------------------------------------
  // CLICKABLE SUMMARY (scroll + highlight)
  // ------------------------------------------
  summaryEl.querySelectorAll("[data-target]").forEach((el) => {
    el.style.cursor = "pointer";

    el.addEventListener("click", () => {
      const type = el.dataset.target;
      const items = Array.from(rulesListEl.children).filter((li) =>
        li.querySelector(".rule-origin")?.textContent.includes(type)
      );

      if (!items.length) return;

      const first = items[0];
      first.scrollIntoView({ behavior: "smooth", block: "center" });

      items.forEach((li) => {
        li.style.background = "rgba(255,255,255,0.08)";
        setTimeout(() => {
          li.style.background = "transparent";
        }, 1100);
      });
    });
  });
  break;


  // ================================================================
  // SUMMARY BLOCK
  // Server sends: msg.summary = { passed, failed, clarified, total }
  // ================================================================
  const summary = msg.summary || {
    passed: 0,
    failed: 0,
    clarified: 0,
    total: msg.rules.length || 0,
  };

  const summaryEl = document.getElementById("rules-summary");

  summaryEl.innerHTML = `
    <div class="summary-title">Governance Compliance Summary</div>

    <div><span class="summary-pass">✔ ${summary.passed}</span> passed</div>
    <div><span class="summary-clarified">⚠ ${summary.clarified}</span> required clarification</div>
    <div><span class="summary-fail">✖ ${summary.failed}</span> failed</div>

    <div style="margin-top:6px; opacity:0.7;">
      Total rules: ${summary.total}
    </div>
  `;
  break;


        rulesListEl.appendChild(li);
      });
      break;

    // =========================================================

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
      latestLedger = msg.entries;
      ledgerLogEl.innerHTML = "";
      latestLedger.forEach((entry) => {
        addLog(
          ledgerLogEl,
          `[${entry.timestamp}] (${entry.stage} – cycle ${entry.cycle}) ${entry.summary}`,
          "ledger"
        );
      });
      break;

    case "final-output":
      appendFinalMessage(msg.text);
      break;

    case "clarification-request":
      appendSystemMessage("⚠️ Clarification required:\n" + msg.question);
      break;

    default:
      console.warn("Unknown telemetry:", msg);
  }
});
