// Shows what hybrid retrieval returns for a question, with both ranks.
// Runs as OWNER_ID. Usage: npm run search -- "what is an eigenvalue?"
import { retrieve } from "../lib/retrieval/retrieve.ts";

const ownerId = process.env.OWNER_ID!;
const question = process.argv.slice(2).join(" ");
const TOP_K = 5; // results shown

const rows = await retrieve(question, TOP_K, { ownerId });

console.log(`Q: ${question}`);
console.table(
  rows.map(({ section, pages, kind, semantic_rank, keyword_rank, score, text }) => ({
    section,
    pages,
    kind,
    semantic_rank,
    keyword_rank,
    score,
    preview: text.slice(0, 160),
  }))
);
