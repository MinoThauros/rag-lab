// Answers one question: retrieve the best chunks from the owner's documents, then
// ask Qwen to answer only from them, citing sources. With a conversation context,
// the rolling summary and the recent turns are included so follow-ups make sense.
import OpenAI from "openai";
import { ANSWER_SYSTEM_PROMPT } from "../constants/prompts.ts";
import { qwen, QWEN_MODEL } from "../lib/qwen.ts";
import { retrieve, type RetrievalScope, type RetrievedChunk } from "../lib/retrieval/retrieve.ts";
import type { ConversationContext } from "../types/conversation.ts";
import { extractCitations } from "../utils/citations.ts";

const TOP_K = 5;
const SOURCE_TOKEN_BUDGET = 3500; // of Qwen's 8,192: leaves room for summary, recent turns, answer

export type Answer = {
  text: string;
  sources: RetrievedChunk[]; // everything sent to the model, in rank order
  cited: number[]; // source numbers the answer actually cites
  promptTokens?: number;
  answerTokens?: number;
};

export async function answerQuestionService(
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
    ? `${ANSWER_SYSTEM_PROMPT}\n\nSummary of the conversation so far:\n${context.summary}`
    : ANSWER_SYSTEM_PROMPT;

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

  return {
    text,
    sources,
    cited: extractCitations(text, sources.length),
    promptTokens: usage?.prompt_tokens,
    answerTokens: usage?.completion_tokens,
  };
}
