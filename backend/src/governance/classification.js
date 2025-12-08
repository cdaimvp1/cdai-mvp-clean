require("dotenv").config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL_NAME = "gpt-4o";

function safeParseIntentResponse(raw, { fallback = null, label = "IntentClassifier" } = {}) {
  const warn = (msg) =>
    console.warn(`[Governance][safeParseIntentResponse] ${label}: ${msg}`);

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

function buildClassificationFallback(input) {
  return {
    intent: "task",
    confidence: 0.4,
    reason: "Fallback: could not parse classifier JSON; defaulting to 'task'.",
  };
}

function normalizeClassification(intentObject = {}) {
  const intent = intentObject.intent || intentObject.label || "task";
  const normalized = {
    ...intentObject,
    intent,
    label: intentObject.label || intent,
    confidence:
      typeof intentObject.confidence === "number" ? intentObject.confidence : intentObject.confidence || 0,
  };
  return normalized;
}

async function classifyIntent(input, { strictnessLevel, rawUserText } = {}) {
  const text = (input || "").trim();
  if (!text) {
    return {
      intent: "chat",
      confidence: 0.0,
      reason: "Empty input; needs clarification before classification.",
    };
  }

  const normalized = text.replace(/\s+/g, " ");
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;

  const actionableMarkers = [
    "draft",
    "write",
    "generate",
    "summarize",
    "create",
    "compose",
    "prepare",
    "produce",
    "design",
    "plan",
    "proposal",
    "report",
    "email",
    "memo",
    "outline",
    "bullet point",
  ];
  const hasActionableVerb = actionableMarkers.some((m) =>
    normalized.toLowerCase().includes(m)
  );
  if (hasActionableVerb) {
    return {
      intent: "task",
      confidence: 0.95,
      reason: "Detected actionable directive; defaulting to governed task.",
      task: text,
    };
  }

  if (wordCount < 2 || /^[\d\W]+$/.test(normalized)) {
    return {
      intent: "chat",
      confidence: 0.1,
      reason: "Unparseable or fragmentary input; clarification requested.",
      needs_clarification: true,
    };
  }

  const system = `
You classify user messages for a governed AI system (cd\\ai).

Your job is to determine, at a high level, what the user is doing.

You MUST return JSON ONLY in this shape:
{
  "intent": "chat" | "task" | "rules" | "mixed",
  "confidence": 0.0-1.0,
  "reason": "short explanation"
}

Definitions:
- "chat": The user is talking conversationally, asking conceptual questions, venting, or exploring ideas.
         There is no clear request to perform a concrete task or produce an actionable governed output.
- "task": The user is clearly asking the system to DO something (draft an email, write a policy, design a process, etc).
          There may be some governance hints, but rules are not the main focus of the message.
- "rules": The user is primarily specifying, updating, or asking to clear / change governance rules, constraints, or policies.
           No concrete execution task is requested.
- "mixed": The user both describes a task AND provides governance rules/policies for how that task must be executed.

When in doubt:
- Prefer "task" if the user clearly wants an actionable output.
- Prefer "mixed" if they are giving both the task and explicit constraints/policies.
- Prefer "rules" only if the message is almost entirely about what rules apply, with no concrete task to execute now.
- Prefer "chat" for pure explanation / ideation / meta discussion.
- Do not request clarification unless the message is non-linguistic or blank.
`;

  const user = `User message:
${text}`;

  const raw = await callOpenAIChat({
    system,
    user,
    temperature: 0,
    response_format: "json"
  });

  const parsed = safeParseIntentResponse(raw, { fallback: {}, label: "IntentClassifier" });
  if (parsed.ok && parsed.value && typeof parsed.value.intent === "string") {
    return normalizeClassification(parsed.value);
  }

  return buildClassificationFallback(text);
}

async function callOpenAIChat({
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

module.exports = {
  classifyIntent,
  classifyUserIntent: classifyIntent, // <-- compatibility alias
  safeParseIntentResponse,
  buildClassificationFallback,
  normalizeClassification,
};
