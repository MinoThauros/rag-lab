// HTTP API for the web app (web/). Streams answers as Server-Sent Events.
//   GET /api/ask?q=…  →  event: token  (repeated)  then  event: done  (sources, usage)
// Usage: npm run web:api   (listens on 127.0.0.1:3100, local only)
import express from "express";
import pg from "pg";
import { answer } from "./answer.ts";

const PORT = 3100;

// pg's built-in pool: concurrent questions (two tabs) each get a connection.
const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const app = express();

app.get("/api/ask", async (req, res) => {
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
    const result = await answer(db, question, (token) => send("token", token));
    send("done", {
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

app.listen(PORT, "127.0.0.1", () => console.log(`API on http://127.0.0.1:${PORT}`));
