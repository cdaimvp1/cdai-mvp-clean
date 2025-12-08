require("dotenv").config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL_NAME = "gpt-4o";
const OPENAI_STUB =
  process.env.ALLOW_OPENAI_STUB === "1" ||
  process.env.OPENAI_STUB === "1" ||
  process.env.NODE_ENV === "test" ||
  globalThis.__ALLOW_OPENAI_STUB__ === true;
const RESOLVED_KEY = OPENAI_API_KEY || process.env.OPENAI_TEST_KEY || (OPENAI_STUB ? "stub-key" : null);

async function callOpenAIChat({
  system,
  user,
  temperature = 0.4,
  response_format,
}) {
  if (!RESOLVED_KEY) {
    console.error("[cd/ai] OPENAI_API_KEY missing.");
    return null;
  }

  const maxRetries = 3;
  const baseDelayMs = 1500; // 1.5s base backoff

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

      // TEST-D-FIX: allow stubbed fetch path without leaking production credentials
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RESOLVED_KEY}`,
        },
        body: JSON.stringify(body),
      });

      // SUCCESS
      if (response.ok) {
        const data = await response.json();
        return data.choices?.[0]?.message?.content?.trim() || null;
      }

      // --- 429 RATE LIMIT EXCEEDED ----------------------------------------
      if (response.status === 429 && attempt < maxRetries) {
        let retryAfterHeader = response.headers.get("retry-after");
        let retryAfterSeconds = Number(retryAfterHeader);
        let delayMs;

        if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
          delayMs = retryAfterSeconds * 1000;
        } else {
          delayMs = baseDelayMs * Math.pow(2, attempt); // 1.5s → 3s → 6s
        }

        console.warn(
          `[cd/ai] OpenAI rate limit (429). Attempt ${
            attempt + 1
          }/${maxRetries}. Retrying in ${delayMs} ms…`
        );

        await new Promise((resolve) => setTimeout(resolve, delayMs));
        attempt++;
        continue;
      }

      // OTHER ERRORS
      const text = await response.text();
      console.error("[cd/ai] OpenAI error:", response.status, text);
      return null;
    } catch (err) {
      // NETWORK ERROR — retry
      if (attempt < maxRetries) {
        const delayMs = baseDelayMs * Math.pow(2, attempt);
        console.warn(
          `[cd/ai] Transient OpenAI error. Attempt ${
            attempt + 1
          }/${maxRetries}. Retrying in ${delayMs} ms…`,
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

  // Should not normally reach
  return null;
}

module.exports = {
  callOpenAIChat,
};
