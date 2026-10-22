// Interactive Q&A in the terminal. Usage: npm run chat
// Each question is answered on its own: there's no conversation memory yet.
import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import pg from "pg";
import { answer, type Answer } from "./answer.ts";

const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect(); // one connection for the whole session

const rl = createInterface({ input, output });
console.log("Mathematics for Machine Learning — ask a question (/sources, /quit)\n");

const sourceLine = (s: Answer["sources"][number]) =>
  `${s.section} — page ${s.pages.join("–")}`;

// Reading lines as an async iterator queues anything typed while an answer is
// streaming, and ends the loop cleanly when input closes (Ctrl-D).
let last: Answer | null = null;
rl.setPrompt("ask> ");
rl.prompt();
for await (const raw of rl) {
  const line = raw.trim();
  if (!line) {
    rl.prompt();
    continue;
  }
  if (line === "/quit") break;

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

  last = await answer(db, line, (token) => output.write(token)); // streams the answer
  output.write("\n\n");
  for (const n of last.cited) console.log(`  [${n}] ${sourceLine(last.sources[n - 1])}`);
  console.log(`  (${last.promptTokens} prompt tokens · ${last.answerTokens} answer tokens)\n`);
  rl.prompt();
}

rl.close();
await db.end();
