// workflow/openaiClient.js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MAX_RETRIES = 6;

export async function safeChatCompletion(args) {
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    try {
      return await client.chat.completions.create(args);
    } catch (err) {
      // Only retry 429 or temporary server failures
      const isRetryable =
        err.code === "rate_limit_exceeded" ||
        err.status === 429 ||
        err.status === 500 ||
        err.status === 503;

      if (!isRetryable) throw err;

      attempt++;
      const delay = Math.min(5000, 500 * attempt + Math.random() * 300);

      console.warn(
        `[OpenAI Retry] Attempt ${attempt}/${MAX_RETRIES}. Waiting ${delay}ms...`
      );

      await new Promise((res) => setTimeout(res, delay));
    }
  }

  throw new Error("OpenAI retry limit exceeded.");
}
