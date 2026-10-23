// Conversation memory, stored in Supabase and scoped to its owner:
// - recent exchanges are sent to the model verbatim;
// - older ones are folded into a rolling summary;
// - follow-ups are rewritten into standalone questions before retrieval, because
//   retrieval can only search with the text it's given ("and with SVD?" finds nothing).
// Every function takes ownerId; another user's conversation id is simply "not found".
import { answer, type Answer, type ConversationContext, type Turn } from "./answer.ts";
import { complete } from "./qwen.ts";
import { supabase } from "./supabase.ts";

const WINDOW_EXCHANGES = 3; // question+answer pairs kept verbatim
const SUMMARY_MAX_WORDS = 200;

type MessageRow = {
  seq: number;
  role: "user" | "assistant";
  content: string;
  standalone_question: string | null;
  sources: unknown;
};

const fail = (step: string, error: { message: string } | null) => {
  if (error) throw new Error(`${step} failed: ${error.message}`);
};

export async function startConversation(ownerId: string): Promise<string> {
  const { data, error } = await supabase
    .from("conversations")
    .insert({ owner_id: ownerId })
    .select("id")
    .single();
  fail("start conversation", error);
  return data!.id;
}

export async function listConversations(ownerId: string) {
  const { data, error } = await supabase
    .from("conversations")
    .select("id, summary, created_at, updated_at")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false })
    .limit(50);
  fail("list conversations", error);
  return data ?? [];
}

async function getConversation(ownerId: string, conversationId: string) {
  const { data, error } = await supabase
    .from("conversations")
    .select("id, summary, summarized_through")
    .eq("id", conversationId)
    .eq("owner_id", ownerId) // tenant check
    .maybeSingle();
  fail("load conversation", error);
  if (!data) throw new ConversationNotFound();
  return data;
}

export class ConversationNotFound extends Error {
  constructor() {
    super("Conversation not found");
  }
}

// All messages, for showing a conversation again.
export async function getMessages(ownerId: string, conversationId: string): Promise<MessageRow[]> {
  await getConversation(ownerId, conversationId);
  const { data, error } = await supabase
    .from("messages")
    .select("seq, role, content, standalone_question, sources")
    .eq("conversation_id", conversationId)
    .order("seq");
  fail("load messages", error);
  return (data ?? []) as MessageRow[];
}

// What the model sees: the summary plus every message after summarized_through.
async function loadContext(ownerId: string, conversationId: string) {
  const conversation = await getConversation(ownerId, conversationId);
  const { data, error } = await supabase
    .from("messages")
    .select("seq, role, content")
    .eq("conversation_id", conversationId)
    .gt("seq", conversation.summarized_through)
    .order("seq");
  fail("load recent messages", error);
  const recent = (data ?? []) as Pick<MessageRow, "seq" | "role" | "content">[];
  return { conversation, recent };
}

const transcript = (turns: Turn[]) =>
  turns.map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`).join("\n\n");

async function rewriteQuestion(context: ConversationContext, question: string): Promise<string> {
  const rewritten = await complete(
    [
      "Rewrite the user's latest message as a standalone question about their documents,",
      'using the conversation so far to resolve references like "it", "that" or "the second one".',
      "If it is already standalone, return it unchanged. Output only the question.",
    ].join(" "),
    [
      context.summary && `Summary of the conversation so far:\n${context.summary}`,
      `Recent conversation:\n${transcript(context.recent)}`,
      `Latest message: ${question}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    100
  );
  return rewritten || question;
}

// Fold exchanges older than the verbatim window into the rolling summary.
async function updateSummary(ownerId: string, conversationId: string) {
  const { conversation, recent } = await loadContext(ownerId, conversationId);
  const keep = WINDOW_EXCHANGES * 2;
  if (recent.length <= keep) return;

  const toFold = recent.slice(0, recent.length - keep);
  const summary = await complete(
    [
      "Update the running summary of this study session.",
      "Keep: what the user is trying to learn, what has been established",
      "(definitions, results, worked examples with their numbers), and open questions.",
      `Drop small talk. Under ${SUMMARY_MAX_WORDS} words. Output only the summary.`,
    ].join(" "),
    [
      `Current summary:\n${conversation.summary || "(empty)"}`,
      `Exchanges to fold in:\n${transcript(toFold)}`,
    ].join("\n\n"),
    400
  );

  const { error } = await supabase
    .from("conversations")
    .update({ summary, summarized_through: toFold.at(-1)!.seq, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("owner_id", ownerId);
  fail("update summary", error);
}

export type ConversationAnswer = Answer & { standalone: string };

// One turn: rewrite → retrieve + answer → save → fold old turns into the summary.
export async function askInConversation(
  ownerId: string,
  conversationId: string,
  question: string,
  onToken: (token: string) => void
): Promise<ConversationAnswer> {
  const { conversation, recent } = await loadContext(ownerId, conversationId);
  const context: ConversationContext = {
    summary: conversation.summary,
    recent: recent.map(({ role, content }) => ({ role, content })),
  };

  const standalone = context.recent.length ? await rewriteQuestion(context, question) : question;
  const result = await answer(standalone, onToken, { ownerId }, context);

  const nextSeq = (recent.at(-1)?.seq ?? conversation.summarized_through) + 1;
  const { error } = await supabase.from("messages").insert([
    {
      conversation_id: conversationId,
      seq: nextSeq,
      role: "user",
      content: question,
      standalone_question: standalone,
    },
    {
      conversation_id: conversationId,
      seq: nextSeq + 1,
      role: "assistant",
      content: result.text,
      sources: result.cited.map((n) => {
        const s = result.sources[n - 1];
        return { n, section: s.section, pages: s.pages, document_id: s.document_id };
      }),
    },
  ]);
  fail("save turn", error);
  await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("owner_id", ownerId);

  // Synchronous: the next turn depends on it.
  await updateSummary(ownerId, conversationId);
  return { ...result, standalone };
}
