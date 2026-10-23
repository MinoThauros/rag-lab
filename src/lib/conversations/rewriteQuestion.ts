// Standalone query rewriting ("condense question"): retrieval can only search with
// the text it's given, so "and with SVD?" must become a self-contained question.
import { REWRITE_SYSTEM_PROMPT } from "../../constants/prompts.ts";
import type { ConversationContext } from "../../types/conversation.ts";
import { formatTranscript } from "../../utils/transcript.ts";
import { complete } from "../qwen.ts";

export async function rewriteQuestion(context: ConversationContext, question: string): Promise<string> {
  const rewritten = await complete(
    REWRITE_SYSTEM_PROMPT,
    [
      context.summary && `Summary of the conversation so far:\n${context.summary}`,
      `Recent conversation:\n${formatTranscript(context.recent)}`,
      `Latest message: ${question}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    100
  );
  return rewritten || question;
}
