export type Turn = { role: "user" | "assistant"; content: string };

// What the answering model sees from a conversation: the rolling summary plus
// the recent turns kept verbatim.
export type ConversationContext = { summary: string; recent: Turn[] };

export type MessageRow = {
  seq: number;
  role: "user" | "assistant";
  content: string; // exactly what was typed, or the answer text
  standalone_question: string | null; // user turns: the rewritten question used for search
  sources: unknown; // assistant turns: cited sections and pages
};
