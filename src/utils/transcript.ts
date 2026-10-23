import type { Turn } from "../types/conversation.ts";

// "User: …\n\nAssistant: …" text for prompts that read the conversation.
export const formatTranscript = (turns: Turn[]) =>
  turns.map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`).join("\n\n");
