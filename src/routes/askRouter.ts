// GET /api/ask?q=…&conversation=<id>  streams the answer as Server-Sent Events:
//   event: conversation  (new conversation id, only when none was given)
//   event: token         (repeated)
//   event: done          (sources, standalone question, usage) | event: failure
import { Router } from "express";
import { startConversation } from "../lib/conversations/conversationStore.ts";
import { requireAuth } from "../middleware/requireAuth.ts";
import { askInConversationService } from "../services/askInConversationService.ts";

export const askRouter = Router();

askRouter.get("/", requireAuth, async (req, res) => {
  const ownerId = req.user!.id;
  const question = String(req.query.q ?? "").trim();
  if (!question) {
    res.status(400).send("missing q");
    return;
  }

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  const send = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    let conversationId = typeof req.query.conversation === "string" ? req.query.conversation : "";
    if (!conversationId) {
      conversationId = await startConversation(ownerId);
      send("conversation", conversationId);
    }

    const result = await askInConversationService(ownerId, conversationId, question, (token) =>
      send("token", token)
    );
    send("done", {
      standalone: result.standalone,
      cited: result.cited,
      sources: result.sources.map(({ section, pages, kind, semantic_rank, keyword_rank }) => ({
        section, pages, kind, semantic_rank, keyword_rank,
      })),
      promptTokens: result.promptTokens,
      answerTokens: result.answerTokens,
    });
  } catch (error) {
    send("failure", { message: error instanceof Error ? error.message : String(error) });
  }
  res.end();
});
