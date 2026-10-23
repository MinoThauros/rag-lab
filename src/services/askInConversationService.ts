// One conversation turn: load the summary and recent turns → rewrite the question
// into a standalone one → retrieve and answer → save both messages → fold turns
// older than the verbatim window into the rolling summary (synchronously, since
// the next turn depends on it).
import { getConversation, getMessages, saveSummary, saveTurn } from "../lib/conversations/conversationStore.ts";
import { rewriteQuestion } from "../lib/conversations/rewriteQuestion.ts";
import { summarizeExchanges } from "../lib/conversations/summarizeExchanges.ts";
import type { ConversationContext } from "../types/conversation.ts";
import { answerQuestionService, type Answer } from "./answerQuestionService.ts";

const WINDOW_EXCHANGES = 3; // question+answer pairs kept verbatim

export type ConversationAnswer = Answer & { standalone: string };

export async function askInConversationService(
  ownerId: string,
  conversationId: string,
  question: string,
  onToken: (token: string) => void
): Promise<ConversationAnswer> {
  const conversation = await getConversation(ownerId, conversationId);
  const recent = await getMessages(ownerId, conversationId, conversation.summarized_through);
  const context: ConversationContext = {
    summary: conversation.summary,
    recent: recent.map(({ role, content }) => ({ role, content })),
  };

  const standalone = context.recent.length ? await rewriteQuestion(context, question) : question;
  const result = await answerQuestionService(standalone, onToken, { ownerId }, context);

  const firstSeq = (recent.at(-1)?.seq ?? conversation.summarized_through) + 1;
  await saveTurn(
    ownerId,
    conversationId,
    firstSeq,
    { content: question, standalone },
    {
      content: result.text,
      sources: result.cited.map((n) => {
        const s = result.sources[n - 1];
        return { n, section: s.section, pages: s.pages, document_id: s.document_id };
      }),
    }
  );

  // Fold everything older than the window into the summary.
  const verbatim = [...context.recent, { role: "user" as const, content: question }, { role: "assistant" as const, content: result.text }];
  const overflow = verbatim.length - WINDOW_EXCHANGES * 2;
  if (overflow > 0) {
    const summary = await summarizeExchanges(conversation.summary, verbatim.slice(0, overflow));
    await saveSummary(ownerId, conversationId, summary, conversation.summarized_through + overflow);
  }

  return { ...result, standalone };
}
