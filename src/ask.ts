// Answers a question from the book: retrieve the best chunks, then ask Qwen to
// answer only from them, citing sources. Usage: npm run ask -- "what is an eigenvalue?"
import OpenAI from "openai";
import pg from "pg";
import { retrieve } from "./retrieve.ts";

const question = process.argv.slice(2).join(" ");
const TOP_K = 5;
const SOURCE_TOKEN_BUDGET = 4000; // of Qwen's 8,192: leaves room for instructions, question, answer

const qwen = new OpenAI({
  baseURL: process.env.QWEN_BASE_URL, // http://home5070ti:8000/v1, over Tailscale
  apiKey: "none", // vLLM has no API key yet
});

const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();
const retrieved = await retrieve(db, question, TOP_K);
await db.end();

// Keep sources in rank order until the token budget is reached.
const sources: typeof retrieved = [];
let used = 0;
for (const chunk of retrieved) {
  if (used + chunk.tokens > SOURCE_TOKEN_BUDGET) break;
  sources.push(chunk);
  used += chunk.tokens;
}

const system = [
  'You answer questions about the book "Mathematics for Machine Learning".',
  "Use only the numbered sources provided. Cite them inline like [1] or [2][3].",
  'If the sources do not contain the answer, say: "I don\'t know from the provided sources."',
  "Write mathematics in LaTeX.",
].join(" ");

const user = [
  "Sources:",
  ...sources.map((s, i) => `[${i + 1}] (${s.section}, page ${s.pages.join("–")})\n${s.text}`),
  `Question: ${question}`,
].join("\n\n");

const response = await qwen.chat.completions.create({
  model: process.env.QWEN_MODEL!, // Qwen/Qwen3-8B-FP8
  messages: [
    { role: "system", content: system },
    { role: "user", content: user },
  ],
  temperature: 0.2,
  max_tokens: 700,
  // vLLM-specific: turn off Qwen3's <think> reasoning for a direct answer.
  chat_template_kwargs: { enable_thinking: false },
} as OpenAI.ChatCompletionCreateParamsNonStreaming);

console.log(`Q: ${question}\n`);
console.log(response.choices[0].message.content);
console.log("\nSources:");
sources.forEach((s, i) => console.log(`[${i + 1}] ${s.section} — page ${s.pages.join("–")}`));
console.log("\n", {
  promptTokens: response.usage?.prompt_tokens,
  answerTokens: response.usage?.completion_tokens,
});
