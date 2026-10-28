// Which memory shape helps the query rewriter? Same frozen conversations, same Qwen,
// same scoring; only the rewriter's input changes. Results: docs/journal.md (2026-10-28).
//   today     rolling summary + last 3 exchanges (what the app does)
//   B         numbered earlier questions, each with a one-line note on its answer, + last exchange
//   B3-all    every question numbered with its note, + last 3 exchanges word for word
//   B3-older  notes only for turns older than the window, + last 3 exchanges word for word
// Usage: npx tsx --env-file=.env src/explorations/rewriterMemoryShapes.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { REWRITE_SYSTEM_PROMPT } from "../constants/prompts.ts";
import { rewriteInput } from "../lib/conversations/rewriteQuestion.ts";
import { complete } from "../lib/qwen.ts";
import { retrieve } from "../lib/retrieval/retrieve.ts";
import type { RewriteCase } from "../types/rewriteEval.ts";
import { EVAL_DOCUMENT_IDS, firstHitRank, rewriteHitsTerms } from "../utils/rewriteEval.ts";

const RUNS = 3;
const CONCURRENCY = 4;
const NEUTRAL = "Earlier questions, oldest first. They may be unrelated to the latest message.";
const NOTE_PROMPT =
  "In one line of at most 20 words, note what this answer covered: the key terms, methods and examples it named. Output only the note.";

const ownerId = process.env.OWNER_ID!;
const cases: RewriteCase[] = (await readFile("evals/rewrite/cases.jsonl", "utf8"))
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

// One note per answer; threads share answers, so cache by text.
const notes = new Map<string, Promise<string>>();
const noteFor = (answer: string) => {
  if (!notes.has(answer)) notes.set(answer, complete(NOTE_PROMPT, answer, 60));
  return notes.get(answer)!;
};

type Exchange = { n: number; user: string; assistant: string };
const exchangesOf = (c: RewriteCase): Exchange[] =>
  Array.from({ length: c.transcript.length / 2 }, (_, k) => ({
    n: k + 1,
    user: c.transcript[2 * k].content,
    assistant: c.transcript[2 * k + 1].content,
  }));

// Numbered questions with notes for `noted` exchanges, the last `verbatim` exchanges in full.
async function shapeInput(c: RewriteCase, noted: Exchange[], verbatim: Exchange[]) {
  const turns = await Promise.all(noted.map(async (e) => ({ n: e.n, question: e.user, answer_note: await noteFor(e.assistant) })));
  return JSON.stringify(
    {
      ...(turns.length && { note: NEUTRAL, earlier_turns: turns }),
      ...(verbatim.length === 1
        ? { last_exchange: { user: verbatim[0].user, assistant: verbatim[0].assistant } }
        : { recent_exchanges: verbatim }),
      latest_message: c.message,
    },
    null,
    2
  );
}

const shapes: Record<string, (c: RewriteCase) => Promise<string>> = {
  today: async (c) => rewriteInput({ summary: c.summary, recent: c.history }, c.message),
  B: async (c) => {
    const all = exchangesOf(c);
    return shapeInput(c, all, all.slice(-1));
  },
  "B3-all": async (c) => {
    const all = exchangesOf(c);
    return shapeInput(c, all, all.slice(-c.history.length / 2));
  },
  "B3-older": async (c) => {
    const all = exchangesOf(c);
    const window = c.history.length / 2;
    return shapeInput(c, all.slice(0, all.length - window), all.slice(-window));
  },
};

const rankFor = async (c: RewriteCase, query: string) =>
  firstHitRank(c, (await retrieve(query, 5, { ownerId, documentIds: EVAL_DOCUMENT_IDS })).map((chunk) => chunk.section));

async function evalCase(c: RewriteCase) {
  const runs: Record<string, { query: string; terms: boolean; rank: number | null }[]> = {};
  for (const [name, inputFor] of Object.entries(shapes)) {
    const input = await inputFor(c);
    runs[name] = [];
    for (let run = 0; run < RUNS; run++) {
      const query = (await complete(REWRITE_SYSTEM_PROMPT, input, 100)) || c.message;
      runs[name].push({ query, terms: rewriteHitsTerms(c, query), rank: await rankFor(c, query) });
    }
  }
  return { id: c.id, split: c.split, category: c.category, message: c.message, runs };
}

const results: Awaited<ReturnType<typeof evalCase>>[] = [];
for (let i = 0; i < cases.length; i += CONCURRENCY) {
  results.push(...(await Promise.all(cases.slice(i, i + CONCURRENCY).map(evalCase))));
  process.stdout.write(`\r${results.length}/${cases.length} cases`);
}
console.log("\n");

for (const split of ["dev", "heldout"] as const) {
  for (const name of Object.keys(shapes)) {
    const runs = results.filter((r) => r.split === split).flatMap((r) => r.runs[name]);
    const wrong = runs.filter((r) => !r.terms).length;
    const hits = runs.filter((r) => r.rank !== null).length;
    console.log(`${split.padEnd(8)}${name.padEnd(10)}wrong ${wrong}/${runs.length}  search hits ${hits}/${runs.length}`);
  }
}

await mkdir("evals/results", { recursive: true });
const file = `evals/results/${new Date().toISOString().replace(/[:.]/g, "-")}-memory-shapes.json`;
await writeFile(file, JSON.stringify({ runs: RUNS, shapes: Object.keys(shapes), results }, null, 2));
console.log(`Saved ${file}`);
