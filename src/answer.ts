// Answers one question from the book: retrieve the best chunks, then ask Qwen to
// answer only from them, citing sources. Shared by ask.ts (one question) and
// chat.ts (interactive).
import OpenAI from "openai";
import { retrieve, type RetrievedChunk } from "./retrieve.ts";

const TOP_K = 5;
const SOURCE_TOKEN_BUDGET = 4000; // of Qwen's 8,192: leaves room for instructions, question, answer

const qwen = new OpenAI({
  baseURL: process.env.QWEN_BASE_URL, // http://home5070ti:8000/v1, over Tailscale
  apiKey: "none", // vLLM has no API key yet
});

const SYSTEM = [
  'You answer questions about the book "Mathematics for Machine Learning".',
  "Use only the numbered sources provided. Cite them inline like [1] or [2][3].",
  'If the sources do not contain the answer, say: "I don\'t know from the provided sources."',
  "Write mathematics in LaTeX.",
].join(" ");

export type Answer = {
  text: string;
  sources: RetrievedChunk[]; // everything sent to the model, in rank order
  cited: number[]; // source numbers the answer actually cites
  promptTokens?: number;
  answerTokens?: number;
};

export async function answer(
  question: string,
  onToken: (token: string) => void
): Promise<Answer> {
  const retrieved = await retrieve(question, TOP_K);

  // Keep sources in rank order until the token budget is reached.
  const sources: RetrievedChunk[] = [];
  let used = 0;
  for (const chunk of retrieved) {
    if (used + chunk.tokens > SOURCE_TOKEN_BUDGET) break;
    sources.push(chunk);
    used += chunk.tokens;
  }

  const user = [
    "Sources:",
    ...sources.map((s, i) => `[${i + 1}] (${s.section}, page ${s.pages.join("–")})\n${s.text}`),
    `Question: ${question}`,
  ].join("\n\n");

  const stream = await qwen.chat.completions.create({
    model: process.env.QWEN_MODEL!, // Qwen/Qwen3-8B-FP8
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: user },
    ],
    temperature: 0.2,
    max_tokens: 700,
    stream: true, // tokens arrive as they're generated
    stream_options: { include_usage: true }, // token counts in the last message
    // vLLM-specific: turn off Qwen3's <think> reasoning for a direct answer.
    chat_template_kwargs: { enable_thinking: false },
  } as OpenAI.ChatCompletionCreateParamsStreaming);

  let text = "";
  let usage: OpenAI.CompletionUsage | undefined;
  for await (const part of stream) {
    const token = part.choices[0]?.delta?.content ?? "";
    if (token) {
      text += token;
      onToken(token);
    }
    if (part.usage) usage = part.usage;
  }

  const cited = [...new Set([...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))]
    .filter((n) => n >= 1 && n <= sources.length)
    .sort((a, b) => a - b);

  return {
    text,
    sources,
    cited,
    promptTokens: usage?.prompt_tokens,
    answerTokens: usage?.completion_tokens,
  };
}
