// Conversations and messages in Supabase. Every function takes ownerId and
// filters by it: another user's conversation id is simply "not found".
import type { MessageRow } from "../../types/conversation.ts";
import { supabase } from "../supabase.ts";

export class ConversationNotFound extends Error {
  constructor() {
    super("Conversation not found");
  }
}

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

export async function getConversation(ownerId: string, conversationId: string) {
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

// Messages after `afterSeq` (0 = all), in order.
export async function getMessages(
  ownerId: string,
  conversationId: string,
  afterSeq = 0
): Promise<MessageRow[]> {
  await getConversation(ownerId, conversationId);
  const { data, error } = await supabase
    .from("messages")
    .select("seq, role, content, standalone_question, sources")
    .eq("conversation_id", conversationId)
    .gt("seq", afterSeq)
    .order("seq");
  fail("load messages", error);
  return (data ?? []) as MessageRow[];
}

export async function saveTurn(
  ownerId: string,
  conversationId: string,
  firstSeq: number,
  user: { content: string; standalone: string },
  assistant: { content: string; sources: unknown }
) {
  const { error } = await supabase.from("messages").insert([
    {
      conversation_id: conversationId,
      seq: firstSeq,
      role: "user",
      content: user.content,
      standalone_question: user.standalone,
    },
    {
      conversation_id: conversationId,
      seq: firstSeq + 1,
      role: "assistant",
      content: assistant.content,
      sources: assistant.sources,
    },
  ]);
  fail("save turn", error);
  await updateConversation(ownerId, conversationId, {});
}

export async function saveSummary(
  ownerId: string,
  conversationId: string,
  summary: string,
  summarizedThrough: number
) {
  await updateConversation(ownerId, conversationId, { summary, summarized_through: summarizedThrough });
}

async function updateConversation(ownerId: string, conversationId: string, fields: object) {
  const { error } = await supabase
    .from("conversations")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("owner_id", ownerId);
  fail("update conversation", error);
}
