require("dotenv").config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL_NAME = "gpt-4o";

function safeParseJsonContent(raw, { fallback = null, label = "LLM JSON" } = {}) {
  const warn = (msg) =>
    console.warn(`[Governance][safeParseJsonContent] ${label}: ${msg}`);

  if (raw === null || raw === undefined) {
    warn("No content to parse; returning fallback.");
    return { ok: false, value: fallback, error: "empty" };
  }

  if (typeof raw !== "string") {
    return { ok: true, value: raw, error: null };
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    warn("Blank content; returning fallback.");
    return { ok: false, value: fallback, error: "blank" };
  }

  const attemptParse = (input) => {
    try {
      return { ok: true, value: JSON.parse(input), error: null };
    } catch (err) {
      return { ok: false, value: fallback, error: err?.message || "parse_error" };
    }
  };

  const direct = attemptParse(trimmed);
  if (direct.ok) return direct;

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    const sliced = trimmed
      .slice(start, end + 1)
      .replace(/,\s*([}\]])/g, "$1");
    const salvage = attemptParse(sliced);
    if (salvage.ok) return salvage;
    warn(`Failed salvage parse: ${salvage.error}`);
    return salvage;
  }

  warn(`Unable to locate JSON body: ${direct.error}`);
  return direct;
}

function getCallOpenAIChat() {
  if (typeof globalThis.callOpenAIChat === "function") {
    return globalThis.callOpenAIChat;
  }
  return localCallOpenAIChat;
}

async function localCallOpenAIChat({
  system,
  user,
  temperature = 0.4,
  response_format,
}) {
  if (!OPENAI_API_KEY) {
    console.error("[cd/ai] OPENAI_API_KEY missing.");
    return null;
  }

  const maxRetries = 3;
  const baseDelayMs = 1500;

  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      const body = {
        model: MODEL_NAME,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature,
      };

      if (response_format === "json") {
        body.response_format = { type: "json_object" };
      }

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const data = await response.json();
        return data.choices?.[0]?.message?.content?.trim() || null;
      }

      if (response.status === 429 && attempt < maxRetries) {
        let retryAfterHeader = response.headers.get("retry-after");
        let retryAfterSeconds = Number(retryAfterHeader);
        let delayMs;

        if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
          delayMs = retryAfterSeconds * 1000;
        } else {
          delayMs = baseDelayMs * Math.pow(2, attempt);
        }

        console.warn(
          `[cd/ai] OpenAI rate limit (429). Attempt ${
            attempt + 1
          }/${maxRetries}. Retrying in ${delayMs} ms...`
        );

        await new Promise((resolve) => setTimeout(resolve, delayMs));
        attempt++;
        continue;
      }

      const text = await response.text();
      console.error("[cd/ai] OpenAI error:", response.status, text);
      return null;
    } catch (err) {
      if (attempt < maxRetries) {
        const delayMs = baseDelayMs * Math.pow(2, attempt);
        console.warn(
          `[cd/ai] Transient OpenAI error. Attempt ${
            attempt + 1
          }/${maxRetries}. Retrying in ${delayMs} ms...`,
          err
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        attempt++;
        continue;
      }

      console.error("[cd/ai] OpenAI call fatal error:", err);
      return null;
    }
  }

  return null;
}

async function extractTasksOnly(rawText) {
  const original = rawText || "";
  const trimmed = original.trim();
  if (!trimmed) {
    return {
      tasks: [],
      tasksNormalized: [],
      parse_error: true,
      raw_response: "",
      error: "empty_input",
    };
  }

  const system = `Extract TASKS ONLY from the user's input. Do NOT extract rules. Return JSON only:
{
  "tasks": [
    { "type": "category", "description": "what to do" },
    ...
  ]
}`;

  if (!OPENAI_API_KEY) {
    console.warn("[cd/ai] OPENAI_API_KEY missing — using safe fallback mode (task-extraction)");
    return {
      tasks: [],
      tasksNormalized: [],
      parse_error: false,
      raw_response: "",
      error: null,
      fallback: { ok: true, value: null, reason: "fallback-no-key" },
    };
  }

  const res = await getCallOpenAIChat()({
    system,
    user: rawText,
    temperature: 0,
    response_format: "json",
  });

  const parsed = safeParseJsonContent(res, { fallback: {}, label: "TaskExtraction" });
  const value = parsed.value || {};
  const rawTasks = Array.isArray(value.tasks) ? value.tasks : [];

  const normalizedTasks = rawTasks
    .map((t) => {
      if (typeof t === "string") {
        return { type: "general", description: t.trim(), rawText: original };
      }
      if (t && typeof t === "object") {
        return {
          type: (t.type || t.category || "general").toString(),
          description: (t.description || t.text || "").toString().trim(),
          rawText: original,
        };
      }
      return null;
    })
    .filter((t) => t && t.description);

  if (!parsed.ok || normalizedTasks.length === 0) {
    return {
      tasks: normalizedTasks.map((t) => t.description),
      tasksNormalized: normalizedTasks,
      parse_error: true,
      raw_response: res,
      error: parsed.error || "no_tasks_extracted",
    };
  }

  return {
    tasks: normalizedTasks.map((t) => t.description),
    tasksNormalized: normalizedTasks,
    parse_error: false,
    raw_response: res,
  };
}

function stripRuleBlocks(text) {
  return (text || "").replace(/rules\s*for\s*task[^:]*:\s*[\s\S]*?(?=\n\s*\n|$)/gi, "").trim();
}

function extractTasks(input, { intentResult } = {}) {
  const cleanedText = stripRuleBlocks(input);
  const taskResult = { tasks: [], parse_error: true, raw_response: "", error: null };

  return (function () {
    return extractTasksOnly(cleanedText).then((res) => {
      taskResult.tasks = Array.isArray(res.tasks) ? res.tasks : [];
      taskResult.parse_error = !!res.parse_error;
      taskResult.raw_response = res.raw_response;
      taskResult.error = res.error;

      let tasks = taskResult.tasks.slice();

      if (intentResult && (intentResult.intent === "rules" || intentResult.intent === "rule_only")) {
        tasks = [];
      } else if (
        intentResult &&
        (intentResult.intent === "task" || intentResult.intent === "mixed") &&
        (taskResult.parse_error || tasks.length === 0)
      ) {
        const fallbackTask = cleanedText.trim();
        if (fallbackTask) {
          tasks = [fallbackTask];
          taskResult.parse_error = false;
        }
      }

      const taskArray = tasks.slice();
      taskArray.parse_error = taskResult.parse_error;
      taskArray.raw_response = taskResult.raw_response;
      taskArray.error = taskResult.error;
      return taskArray;
    });
  })();
}

module.exports = {
  extractTasks,
  extractTasksOnly,
  stripRuleBlocks,
};
