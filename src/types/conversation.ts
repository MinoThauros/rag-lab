export type Turn = { role: "user" | "assistant"; content: string };

// What the answering model sees from a conversation: the rolling summary plus
// the recent turns kept verbatim.
export type ConversationContext = { summary: string; recent: Turn[] };

// What the rewriter sees from a conversation: every exchange, in order, each with
// the one-line note on its answer (null on messages saved before notes existed).
export type Exchange = { user: string; assistant: string; note: string | null };

export type MessageRow = {
  seq: number;
  role: "user" | "assistant";
  content: string; // exactly what was typed, or the answer text
  standalone_question: string | null; // user turns: the rewritten question used for search
  sources: unknown; // assistant turns: cited sections and pages
  answer_note: string | null; // assistant turns: one line on what the answer covered
};
