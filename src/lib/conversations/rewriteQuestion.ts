// Standalone query rewriting ("condense question"): retrieval can only search with
// the text it's given, so "and with SVD?" must become a self-contained question.
import { WINDOW_EXCHANGES } from "../../constants/conversation.ts";
import { REWRITE_SYSTEM_PROMPT } from "../../constants/prompts.ts";
import type { Exchange } from "../../types/conversation.ts";
import { complete } from "../qwen.ts";

// The user message the rewriter sees; shared with the eval's reference model and
// the training data. Every earlier question, numbered, with the note on its answer
// (kept in order, so "the first thing I asked" can be resolved), then the last
// exchanges word for word. No rolling summary: it pulled old topics into new
// questions (docs/journal.md, 2026-10-28).
export const rewriteInput = (exchanges: Exchange[], question: string) =>
  JSON.stringify(
    {
      note: "Earlier questions, oldest first. They may be unrelated to the latest message.",
      earlier_turns: exchanges.map((e, i) => ({ n: i + 1, question: e.user, ...(e.note && { answer_note: e.note }) })),
      recent_exchanges: exchanges
        .map((e, i) => ({ n: i + 1, user: e.user, assistant: e.assistant }))
        .slice(-WINDOW_EXCHANGES),
      latest_message: question,
    },
    null,
    2
  );

export async function rewriteQuestion(exchanges: Exchange[], question: string): Promise<string> {
  const rewritten = await complete(REWRITE_SYSTEM_PROMPT, rewriteInput(exchanges, question), 100);
  return rewritten || question;
}
