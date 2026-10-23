// The signed-in user's conversations.
//   GET /api/conversations       newest first
//   GET /api/conversations/:id   one conversation's messages
import { Router } from "express";
import {
  ConversationNotFound,
  getMessages,
  listConversations,
} from "../lib/conversations/conversationStore.ts";
import { requireAuth } from "../middleware/requireAuth.ts";

export const conversationsRouter = Router();

conversationsRouter.use(requireAuth);

conversationsRouter.get("/", async (req, res) => {
  res.json(await listConversations(req.user!.id));
});

conversationsRouter.get("/:id", async (req, res) => {
  try {
    res.json(await getMessages(req.user!.id, String(req.params.id)));
  } catch (error) {
    if (error instanceof ConversationNotFound) res.status(404).json({ error: error.message });
    else throw error;
  }
});
