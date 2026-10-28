// One conversation turn: load the conversation → rewrite the question into a
// standalone one → retrieve and answer → note what the answer covered → save both
// messages → fold turns older than the verbatim window into the rolling summary.
// The note and the summary are written before returning, since the next turn
// depends on them.
import { WINDOW_EXCHANGES } from "../constants/conversation.ts";
import { getConversation, getMessages, saveSummary, saveTurn } from "../lib/conversations/conversationStore.ts";
import { noteAnswer } from "../lib/conversations/noteAnswer.ts";
import { rewriteQuestion } from "../lib/conversations/rewriteQuestion.ts";
import { summarizeExchanges } from "../lib/conversations/summarizeExchanges.ts";
import type { ConversationContext, Exchange } from "../types/conversation.ts";
import { answerQuestionService, type Answer } from "./answerQuestionService.ts";

export type ConversationAnswer = Answer & { standalone: string };

export async function askInConversationService(
  ownerId: string,
  conversationId: string,
  question: string,
  onToken: (token: string) => void
): Promise<ConversationAnswer> {
  const conversation = await getConversation(ownerId, conversationId);
  const messages = await getMessages(ownerId, conversationId);

  // The answer model: rolling summary + the messages it doesn't cover, verbatim.
  const recent = messages.filter((m) => m.seq > conversation.summarized_through);
  const context: ConversationContext = {
    summary: conversation.summary,
    recent: recent.map(({ role, content }) => ({ role, content })),
  };
  // The rewriter: every exchange, with the note on each answer.
  const exchanges: Exchange[] = [];
  for (let i = 0; i + 1 < messages.length; i += 2) {
    exchanges.push({ user: messages[i].content, assistant: messages[i + 1].content, note: messages[i + 1].answer_note });
  }

  const standalone = exchanges.length ? await rewriteQuestion(exchanges, question) : question;
  const result = await answerQuestionService(standalone, onToken, { ownerId }, context);
  const note = await noteAnswer(result.text);

  const firstSeq = (messages.at(-1)?.seq ?? conversation.summarized_through) + 1;
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
      note,
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
