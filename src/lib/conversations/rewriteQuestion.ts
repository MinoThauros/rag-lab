// Standalone query rewriting ("condense question"): retrieval can only search with
// the text it's given, so "and with SVD?" must become a self-contained question.
// Uses a stronger model than the answering one (gpt-5.4-mini on Foundry): on
// borderline follow-ups Qwen3-8B left the question unchanged about a third of the time.
import { REWRITE_SYSTEM_PROMPT } from "../../constants/prompts.ts";
import type { ConversationContext } from "../../types/conversation.ts";
import { formatTranscript } from "../../utils/transcript.ts";
import { azureOpenAI } from "../azureOpenAI.ts";

export async function rewriteQuestion(context: ConversationContext, question: string): Promise<string> {
  const response = await azureOpenAI.chat.completions.create({
    model: process.env.AZURE_OPENAI_REWRITE_DEPLOYMENT!,
    messages: [
      { role: "system", content: REWRITE_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          context.summary && `Summary of the conversation so far:\n${context.summary}`,
          `Recent conversation:\n${formatTranscript(context.recent)}`,
          `Latest message: ${question}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    // GPT-5 models reject a custom temperature; reasoning tokens count toward this cap.
    max_completion_tokens: 400,
    reasoning_effort: "low",
  });
  return response.choices[0].message.content?.trim() || question;
}
