// Answers one question: retrieve the best chunks from the owner's documents, then
// ask Qwen to answer only from them, citing sources. With a conversation context,
// the rolling summary and the recent turns are included so follow-ups make sense.
import OpenAI from "openai";
import { qwen, QWEN_MODEL } from "./qwen.ts";
import { retrieve, type RetrievalScope, type RetrievedChunk } from "./retrieve.ts";

const TOP_K = 5;
const SOURCE_TOKEN_BUDGET = 3500; // of Qwen's 8,192: leaves room for summary, recent turns, answer

const SYSTEM = [
  "You answer questions about the user's documents.",
  "Use only the numbered sources provided. Cite them inline like [1] or [2][3].",
  'If the sources do not contain the answer, say: "I don\'t know from the provided sources."',
  "Write mathematics in LaTeX.",
].join(" ");

export type Turn = { role: "user" | "assistant"; content: string };
export type ConversationContext = { summary: string; recent: Turn[] };

export type Answer = {
  text: string;
  sources: RetrievedChunk[]; // everything sent to the model, in rank order
  cited: number[]; // source numbers the answer actually cites
  promptTokens?: number;
  answerTokens?: number;
};

export async function answer(
  question: string,
  onToken: (token: string) => void,
  scope: RetrievalScope,
  context?: ConversationContext
): Promise<Answer> {
  const retrieved = await retrieve(question, TOP_K, scope);

  // Keep sources in rank order until the token budget is reached.
  const sources: RetrievedChunk[] = [];
  let used = 0;
  for (const chunk of retrieved) {
    if (used + chunk.tokens > SOURCE_TOKEN_BUDGET) break;
    sources.push(chunk);
    used += chunk.tokens;
  }

  const system = context?.summary
    ? `${SYSTEM}\n\nSummary of the conversation so far:\n${context.summary}`
    : SYSTEM;

  const user = [
    "Sources:",
    ...sources.map((s, i) => `[${i + 1}] (${s.section}, page ${s.pages.join("–")})\n${s.text}`),
    `Question: ${question}`,
  ].join("\n\n");

  const stream = await qwen.chat.completions.create({
    model: QWEN_MODEL,
    messages: [
      { role: "system", content: system },
      ...(context?.recent ?? []), // recent turns verbatim, as real chat messages
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
