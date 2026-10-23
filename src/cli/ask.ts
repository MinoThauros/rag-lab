// Answers one question, without conversation memory. Runs as RAG_OWNER_ID (the
// terminal is the admin's tool; the web app uses real logins).
// Usage: npm run ask -- "what is an eigenvalue?"
import { stdout as output } from "node:process";
import { answerQuestionService } from "../services/answerQuestionService.ts";

const ownerId = process.env.RAG_OWNER_ID!;
const question = process.argv.slice(2).join(" ");

console.log(`Q: ${question}\n`);
const result = await answerQuestionService(question, (token) => output.write(token), { ownerId });

console.log("\n\nSources:");
result.sources.forEach((s, i) => console.log(`[${i + 1}] ${s.section} — page ${s.pages.join("–")}`));
console.log("\n", { promptTokens: result.promptTokens, answerTokens: result.answerTokens });
