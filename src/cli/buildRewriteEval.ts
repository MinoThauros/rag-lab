// Builds the rewrite eval's frozen cases from the hand-written drafts:
//  1. plays each history turn through the real pipeline (Qwen + retrieval) once,
//     folding exchanges past the verbatim window into the rolling summary as the
//     app does, so every eval run sees the same conversation;
//  2. writes a reference rewrite with a frontier model on Foundry, from exactly
//     the input Qwen's rewriter gets. It's the ceiling, not a training label.
// Cases already built keep their frozen conversation; spec fields (expectations)
// are always refreshed from the drafts. Pass ids to rebuild those cases.
// Usage: npm run eval:rewrite:build -- [id …]
import { readFile, writeFile } from "node:fs/promises";
import { REWRITE_SYSTEM_PROMPT } from "../constants/prompts.ts";
import { azureOpenAI } from "../lib/azureOpenAI.ts";
import { rewriteInput } from "../lib/conversations/rewriteQuestion.ts";
import { summarizeExchanges } from "../lib/conversations/summarizeExchanges.ts";
import { answerQuestionService } from "../services/answerQuestionService.ts";
import { WINDOW_EXCHANGES } from "../services/askInConversationService.ts";
import type { ConversationContext, Turn } from "../types/conversation.ts";
import type { DraftCase, RewriteCase } from "../types/rewriteEval.ts";
import { EVAL_DOCUMENT_IDS } from "../utils/rewriteEval.ts";

const DRAFTS = "evals/rewrite/cases.draft.jsonl";
const CASES = "evals/rewrite/cases.jsonl";
const REFERENCE_MODEL = "gpt-5.4-standard"; // Foundry deployment of gpt-5.4 (the "gpt-5.4" one rejects requests)
const CONCURRENCY = 4; // vLLM batches these on the GPU

const ownerId = process.env.OWNER_ID!;
const rebuild = new Set(process.argv.slice(2));

const readJsonl = async <T>(path: string): Promise<T[]> =>
  (await readFile(path, "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

// Plays the user turns through the pipeline, folding the summary as the app does.
// Also keeps the full transcript, so other memory shapes can be built from the same answers.
type Conversation = { context: ConversationContext; transcript: Turn[] };
async function playConversation(userTurns: DraftCase["history"]): Promise<Conversation> {
  const context: ConversationContext = { summary: "", recent: [] };
  const transcript: Turn[] = [];
  for (const turn of userTurns) {
    const answer = await answerQuestionService(turn.standalone ?? turn.user, () => {}, { ownerId, documentIds: EVAL_DOCUMENT_IDS }, {
      summary: context.summary,
      recent: [...context.recent],
    });
    const exchange: Turn[] = [{ role: "user", content: turn.user }, { role: "assistant", content: answer.text }];
    context.recent.push(...exchange);
    transcript.push(...exchange);
    const overflow = context.recent.length - WINDOW_EXCHANGES * 2;
    if (overflow > 0) {
      context.summary = await summarizeExchanges(context.summary, context.recent.slice(0, overflow));
      context.recent = context.recent.slice(overflow);
    }
  }
  return { context, transcript };
}

// One conversation per thread: reuse an already-built case's, or play it once.
const threads = new Map<string, Promise<Conversation>>();
function conversationFor(draft: DraftCase): Promise<Conversation> {
  if (!draft.thread) return playConversation(draft.history);
  if (!threads.has(draft.thread)) {
    const sibling = [...built.values()].find((c) => c.thread === draft.thread && !rebuild.has(c.id));
    threads.set(
      draft.thread,
      sibling
        ? Promise.resolve({ context: { summary: sibling.summary, recent: sibling.history }, transcript: sibling.transcript })
        : playConversation(draft.history)
    );
  }
  return threads.get(draft.thread)!;
}

async function buildCase(draft: DraftCase): Promise<RewriteCase> {
  const { history: _userTurns, ...spec } = draft;
  const { context, transcript } = await conversationFor(draft);

  const response = await azureOpenAI.chat.completions.create({
    model: REFERENCE_MODEL,
    messages: [
      { role: "system", content: REWRITE_SYSTEM_PROMPT },
      { role: "user", content: rewriteInput(context, draft.message) },
    ],
    // GPT-5 models reject a custom temperature; reasoning tokens count toward this cap.
    max_completion_tokens: 2000,
    reasoning_effort: "medium",
  });
  const reference = response.choices[0].message.content?.trim();
  if (!reference) throw new Error(`${draft.id}: empty reference rewrite`);

  return { ...spec, summary: context.summary, history: context.recent, transcript, reference, reference_model: REFERENCE_MODEL };
}

const drafts = await readJsonl<DraftCase>(DRAFTS);
const built = new Map((await readJsonl<RewriteCase & { thread?: string }>(CASES)).map((c) => [c.id, c]));

const toBuild = drafts.filter((d) => !built.has(d.id) || rebuild.has(d.id));
for (let i = 0; i < toBuild.length; i += CONCURRENCY) {
  const batch = await Promise.all(toBuild.slice(i, i + CONCURRENCY).map(buildCase));
  batch.forEach((c) => {
    built.set(c.id, c);
    console.log(`${c.id}: ${c.reference}`);
  });
}

// Draft order; expectations from the draft, frozen conversation from the build.
const cases = drafts.map(({ history, ...spec }) => ({ ...built.get(spec.id)!, ...spec }));
await writeFile(CASES, cases.map((c) => JSON.stringify(c)).join("\n") + "\n");
console.log(`\nBuilt ${toBuild.length}; wrote ${cases.length} cases to ${CASES}`);
