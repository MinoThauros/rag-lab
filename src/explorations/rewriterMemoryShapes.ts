// Which memory shape helps the query rewriter? Same frozen conversations, same Qwen,
// same scoring; only the rewriter's input changes. Results: docs/journal.md (2026-10-28).
//   today     rolling summary + last 3 exchanges (what the app does)
//   B         numbered earlier questions, each with a one-line note on its answer, + last exchange
//   B3-all    every question numbered with its note, + last 3 exchanges word for word
//   B3-older  notes only for turns older than the window, + last 3 exchanges word for word
//   S         one structured rolling summary (numbered questions, topics), updated every turn,
//             + last 3 questions, each with a short summary of its answer instead of the answer
//   S2        S with an accumulating summary instead: "Earlier" compressed with age, "Now" in detail
// Usage: npx tsx --env-file=.env src/explorations/rewriterMemoryShapes.ts [--shapes today,B3-all,S]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
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

const ROLLING_SUMMARY_PROMPT = [
  "You keep the running summary of a study conversation, read by an assistant that rewrites the user's next message into a search query.",
  "Update the current summary with the new numbered exchange. Keep exactly these three parts:",
  'Questions in order: one numbered line per user question, as a short phrase ("1. Hessian matrix"). If it gets long, merge the oldest into a range, but always keep question 1.',
  "Topics: earlier topics and the current topic, each with the question numbers it covers.",
  "Key terms from the answers: named methods, theorems and examples, most recent first.",
  'Never write "the user is learning". At most 120 words. Output only the summary.',
].join("\n");
const ACCUMULATING_SUMMARY_PROMPT = [
  "You maintain the running summary of a study conversation. Rewrite it to include the new numbered exchange.",
  "Keep two parts, in plain words, no formulas or symbols:",
  "Earlier: everything before the latest exchange, compressed, oldest first, with question numbers. The older it is, the shorter. Merge related questions into one phrase.",
  "Now: the latest exchange: what was asked and what the answer explained, in one or two sentences.",
  "At most 100 words. Output only the summary.",
].join("\n");
const ANSWER_SUMMARY_PROMPT =
  "Summarize this answer in at most 25 words: what it explained, and the methods, terms or examples it named. Output only the summary.";

const { values: args } = parseArgs({ options: { shapes: { type: "string" } } });
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

// S: the rolling summary after each turn, cached by conversation prefix (threads share it).
const answerSummaries = new Map<string, Promise<string>>();
const answerSummaryFor = (answer: string) => {
  if (!answerSummaries.has(answer)) answerSummaries.set(answer, complete(ANSWER_SUMMARY_PROMPT, answer, 50));
  return answerSummaries.get(answer)!;
};
const rollingSummaries = new Map<string, Promise<string>>();
function rollingSummaryAfter(prompt: string, exchanges: Exchange[]): Promise<string> {
  const key = JSON.stringify([prompt, exchanges.map((e) => e.user)]);
  if (!rollingSummaries.has(key)) {
    const previous = exchanges.length > 1 ? rollingSummaryAfter(prompt, exchanges.slice(0, -1)) : Promise.resolve("(empty)");
    const last = exchanges.at(-1)!;
    rollingSummaries.set(
      key,
      previous.then((summary) =>
        complete(
          prompt,
          `Current summary:\n${summary}\n\nNew exchange:\n${last.n}. User: ${last.user}\nAssistant: ${last.assistant}`,
          220
        )
      )
    );
  }
  return rollingSummaries.get(key)!;
}
async function inputS(c: RewriteCase, prompt: string) {
  const all = exchangesOf(c);
  const recent = all.slice(-c.history.length / 2);
  return JSON.stringify(
    {
      conversation_summary: await rollingSummaryAfter(prompt, all),
      recent_exchanges: await Promise.all(
        recent.map(async (e) => ({ n: e.n, user: e.user, answer_summary: await answerSummaryFor(e.assistant) }))
      ),
      latest_message: c.message,
    },
    null,
    2
  );
}

const allShapes: Record<string, (c: RewriteCase) => Promise<string>> = {
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
  S: (c) => inputS(c, ROLLING_SUMMARY_PROMPT),
  S2: (c) => inputS(c, ACCUMULATING_SUMMARY_PROMPT),
};
const shapes = args.shapes
  ? Object.fromEntries(args.shapes.split(",").map((name) => [name, allShapes[name]]))
  : allShapes;

const rankFor = async (c: RewriteCase, query: string) =>
  firstHitRank(c, (await retrieve(query, 5, { ownerId, documentIds: EVAL_DOCUMENT_IDS })).map((chunk) => chunk.section));

async function evalCase(c: RewriteCase) {
  const runs: Record<string, { query: string; terms: boolean; rank: number | null }[]> = {};
  const inputs: Record<string, string> = {};
  for (const [name, inputFor] of Object.entries(shapes)) {
    const input = (inputs[name] = await inputFor(c));
    runs[name] = [];
    for (let run = 0; run < RUNS; run++) {
      const query = (await complete(REWRITE_SYSTEM_PROMPT, input, 100)) || c.message;
      runs[name].push({ query, terms: rewriteHitsTerms(c, query), rank: await rankFor(c, query) });
    }
  }
  return { id: c.id, split: c.split, category: c.category, message: c.message, inputs, runs };
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
