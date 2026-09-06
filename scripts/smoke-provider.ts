/**
 * Optional local smoke: prints one streamed reply from an OpenAI-compatible endpoint.
 * Skips when OPENAI_API_KEY is unset — no key required for Task 6.
 *
 *   OPENAI_API_KEY=... OPENAI_BASE_URL=https://api.openai.com/v1 pnpm exec tsx scripts/smoke-provider.ts
 */
import { createOpenAICompatibleModel } from "../packages/providers/src/index.ts";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.log("skip: OPENAI_API_KEY not set");
  process.exit(0);
}

const model = createOpenAICompatibleModel({
  id: "smoke",
  baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  apiKey,
  model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
});

let text = "";
for await (const event of model.stream({
  messages: [{ role: "user", content: "Reply with a single short sentence." }],
  tools: [],
})) {
  if (event.type === "text_delta") {
    text += event.text;
  }
}
console.log(text);
