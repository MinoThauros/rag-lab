// HTTP API for the web app (web/). Every /api route except login requires a
// Supabase session (httpOnly cookies) and is scoped to req.user.id.
//   POST /api/auth/login | POST /api/auth/logout | GET /api/auth/me
//   GET  /api/conversations              your conversations, newest first
//   GET  /api/conversations/:id          one conversation's messages
//   GET  /api/ask?q=…&conversation=<id>  streams the answer as Server-Sent Events:
//        event: conversation (new conversation id, only when none was given)
//        event: token (repeated) → event: done (sources, standalone question, usage)
// Usage: npm run web:api   (listens on 127.0.0.1:3100, local only)
import cookieParser from "cookie-parser";
import express from "express";
import { authRouter } from "./auth.ts";
import {
  askInConversation,
  ConversationNotFound,
  getMessages,
  listConversations,
  startConversation,
} from "./conversation.ts";
import { requireAuth } from "./requireAuth.ts";

const PORT = 3100;

const app = express();
app.use(express.json());
app.use(cookieParser());

app.use("/api/auth", authRouter);

app.get("/api/conversations", requireAuth, async (req, res) => {
  res.json(await listConversations(req.user!.id));
});

app.get("/api/conversations/:id", requireAuth, async (req, res) => {
  try {
    res.json(await getMessages(req.user!.id, String(req.params.id)));
  } catch (error) {
    if (error instanceof ConversationNotFound) res.status(404).json({ error: error.message });
    else throw error;
  }
});

app.get("/api/ask", requireAuth, async (req, res) => {
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

    const result = await askInConversation(ownerId, conversationId, question, (token) =>
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

app.listen(PORT, "127.0.0.1", (error) => {
  if (error) {
    // Express 5 reports listen errors here (e.g. EADDRINUSE); don't claim to be running.
    console.error(`Could not start the API on port ${PORT}: ${error.message}`);
    process.exit(1);
  }
  console.log(`API on http://127.0.0.1:${PORT}`);
});
