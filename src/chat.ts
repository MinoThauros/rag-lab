// Interactive Q&A in the terminal, with conversation memory stored in Supabase.
// Runs as RAG_OWNER_ID (the admin's tool). Usage: npm run chat
// Commands: /new (fresh conversation), /sources (last retrieval), /quit
import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { askInConversation, startConversation, type ConversationAnswer } from "./conversation.ts";

const ownerId = process.env.RAG_OWNER_ID!;
let conversationId = await startConversation(ownerId);

const rl = createInterface({ input, output });
console.log("Ask a question about your documents (/new, /sources, /quit)\n");

const sourceLine = (s: ConversationAnswer["sources"][number]) =>
  `${s.section} — page ${s.pages.join("–")}`;

// Reading lines as an async iterator queues anything typed while an answer is
// streaming, and ends the loop cleanly when input closes (Ctrl-D).
let last: ConversationAnswer | null = null;
rl.setPrompt("ask> ");
rl.prompt();
for await (const raw of rl) {
  const line = raw.trim();
  if (!line) {
    rl.prompt();
    continue;
  }
  if (line === "/quit") break;

  if (line === "/new") {
    conversationId = await startConversation(ownerId);
    last = null;
    console.log("  (new conversation)\n");
    rl.prompt();
    continue;
  }

  if (line === "/sources") {
    // Everything retrieved for the last answer, with both ranks.
    last?.sources.forEach((s, i) =>
      console.log(
        `  [${i + 1}] ${sourceLine(s)} (semantic ${s.semantic_rank ?? "–"}, keyword ${s.keyword_rank ?? "–"})`
      )
    );
    console.log();
    rl.prompt();
    continue;
  }

  last = await askInConversation(ownerId, conversationId, line, (token) => output.write(token));
  output.write("\n\n");
  if (last.standalone !== line) console.log(`  searched for: ${last.standalone}`);
  for (const n of last.cited) console.log(`  [${n}] ${sourceLine(last.sources[n - 1])}`);
  console.log(`  (${last.promptTokens} prompt tokens · ${last.answerTokens} answer tokens)\n`);
  rl.prompt();
}

rl.close();
