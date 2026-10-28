// Rewrite eval: replays each frozen conversation, rewrites the latest message with
// the live rewriter, and retrieves with three queries per case:
//   raw       the message as typed (floor: no rewrite at all)
//   rewrite   the live rewriter's output, once per run (where we are)
//   reference the frontier model's rewrite (ceiling for this retrieval)
// Prints a table per category and saves every rewrite to evals/results/.
// The rewriter is Qwen (what the app uses) or a Foundry deployment, for comparison.
// Usage: npm run eval:rewrite -- [--rewriter qwen|gpt-5.4-mini|gpt-5.4-standard] [--runs 3]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { REWRITE_SYSTEM_PROMPT } from "../constants/prompts.ts";
import { azureOpenAI } from "../lib/azureOpenAI.ts";
import { rewriteInput, rewriteQuestion } from "../lib/conversations/rewriteQuestion.ts";
import { QWEN_MODEL } from "../lib/qwen.ts";
import { retrieve } from "../lib/retrieval/retrieve.ts";
import type { RewriteCase } from "../types/rewriteEval.ts";
import type { Exchange } from "../types/conversation.ts";
import { EVAL_DOCUMENT_IDS, exchangesOf, firstHitRank, isUnchanged, rewriteHitsTerms } from "../utils/rewriteEval.ts";

const CASES = "evals/rewrite/cases.jsonl";
const TOP_K = 5; // what the answer step sees
const CONCURRENCY = 4;

const { values: args } = parseArgs({
  options: { rewriter: { type: "string", default: "qwen" }, runs: { type: "string", default: "3" } },
});
const runs = Number(args.runs);
const ownerId = process.env.OWNER_ID!;

// Same system prompt and input as the app's rewriter; only the model changes.
async function rewriteWithFoundry(exchanges: Exchange[], question: string) {
  const response = await azureOpenAI.chat.completions.create({
    model: args.rewriter!,
    messages: [
      { role: "system", content: REWRITE_SYSTEM_PROMPT },
      { role: "user", content: rewriteInput(exchanges, question) },
    ],
    // GPT-5 models reject a custom temperature; reasoning tokens count toward this cap.
    max_completion_tokens: 2000,
    reasoning_effort: "medium",
  });
  return response.choices[0].message.content?.trim() || question;
}

const rewriterName = args.rewriter === "qwen" ? QWEN_MODEL : args.rewriter!;
const rewrite = args.rewriter === "qwen" ? rewriteQuestion : rewriteWithFoundry;

const rankFor = async (c: RewriteCase, query: string) =>
  firstHitRank(c, (await retrieve(query, TOP_K, { ownerId, documentIds: EVAL_DOCUMENT_IDS })).map((chunk) => chunk.section));

type RunResult = { rewrite: string; terms: boolean; unchanged: boolean; rank: number | null };
type CaseResult = { case: RewriteCase; rawRank: number | null; referenceRank: number | null; runs: RunResult[] };

async function evalCase(c: RewriteCase): Promise<CaseResult> {
  const exchanges = exchangesOf(c);
  const [rawRank, referenceRank] = await Promise.all([rankFor(c, c.message), rankFor(c, c.reference)]);
  const results: RunResult[] = [];
  for (let run = 0; run < runs; run++) {
    const rewritten = await rewrite(exchanges, c.message);
    results.push({
      rewrite: rewritten,
      terms: rewriteHitsTerms(c, rewritten),
      unchanged: isUnchanged(c.message, rewritten),
      rank: await rankFor(c, rewritten),
    });
  }
  return { case: c, rawRank, referenceRank, runs: results };
}

const cases: RewriteCase[] = (await readFile(CASES, "utf8"))
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const results: CaseResult[] = [];
for (let i = 0; i < cases.length; i += CONCURRENCY) {
  results.push(...(await Promise.all(cases.slice(i, i + CONCURRENCY).map(evalCase))));
  process.stdout.write(`\r${results.length}/${cases.length} cases`);
}
console.log("\n");

const pct = (values: boolean[]) => `${Math.round((100 * values.filter(Boolean).length) / values.length)}%`;
const mrr = (ranks: (number | null)[]) =>
  (ranks.reduce<number>((sum, r) => sum + (r ? 1 / r : 0), 0) / ranks.length).toFixed(2);

function summarize(group: CaseResult[]) {
  const runResults = group.flatMap((r) => r.runs);
  return {
    cases: group.length,
    "rewrite terms": pct(runResults.map((r) => r.terms)),
    unchanged: pct(runResults.map((r) => r.unchanged)),
    "hit@5 raw": pct(group.map((r) => r.rawRank !== null)),
    "hit@5 rewrite": pct(runResults.map((r) => r.rank !== null)),
    "hit@5 reference": pct(group.map((r) => r.referenceRank !== null)),
    "MRR rewrite": mrr(runResults.map((r) => r.rank)),
    "MRR reference": mrr(group.map((r) => r.referenceRank)),
  };
}

const byCategory = (group: CaseResult[]) => ({
  ...Object.fromEntries(
    [...new Set(group.map((r) => r.case.category))].map((cat) => [
      cat,
      summarize(group.filter((r) => r.case.category === cat)),
    ])
  ),
  all: summarize(group),
});

const dev = results.filter((r) => r.case.split === "dev");
for (const difficulty of ["easy", "hard"] as const) {
  console.log(`dev, ${difficulty} (${runs} runs per case, rewriter ${rewriterName})`);
  console.table(byCategory(dev.filter((r) => r.case.difficulty === difficulty)));
}
const heldout = results.filter((r) => r.case.split === "heldout");
console.log(`heldout (${runs} runs per case, rewriter ${rewriterName})`);
console.table({
  easy: summarize(heldout.filter((r) => r.case.difficulty === "easy")),
  hard: summarize(heldout.filter((r) => r.case.difficulty === "hard")),
  all: summarize(heldout),
});

await mkdir("evals/results", { recursive: true });
const file = `evals/results/${new Date().toISOString().replace(/[:.]/g, "-")}-${rewriterName.replace(/\//g, "_")}.json`;
await writeFile(
  file,
  JSON.stringify(
    {
      rewriter: rewriterName,
      runs,
      cases: results.map(({ case: c, rawRank, referenceRank, runs }) => ({
        id: c.id,
        message: c.message,
        reference: c.reference,
        rawRank,
        referenceRank,
        runs,
      })),
    },
    null,
    2
  )
);
console.log(`Saved ${file}`);
