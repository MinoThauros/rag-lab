// Answers one question. Usage: npm run ask -- "what is an eigenvalue?"
import { stdout as output } from "node:process";
import pg from "pg";
import { answer } from "./answer.ts";

const question = process.argv.slice(2).join(" ");

const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

console.log(`Q: ${question}\n`);
const result = await answer(db, question, (token) => output.write(token));
await db.end();

console.log("\n\nSources:");
result.sources.forEach((s, i) => console.log(`[${i + 1}] ${s.section} — page ${s.pages.join("–")}`));
console.log("\n", { promptTokens: result.promptTokens, answerTokens: result.answerTokens });
