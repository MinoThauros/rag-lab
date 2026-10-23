// Answers one question. Usage: npm run ask -- "what is an eigenvalue?"
import { stdout as output } from "node:process";
import { answer } from "./answer.ts";

const question = process.argv.slice(2).join(" ");

console.log(`Q: ${question}\n`);
const result = await answer(question, (token) => output.write(token));

console.log("\n\nSources:");
result.sources.forEach((s, i) => console.log(`[${i + 1}] ${s.section} — page ${s.pages.join("–")}`));
console.log("\n", { promptTokens: result.promptTokens, answerTokens: result.answerTokens });
