// Fills chunks.embedding for one document (model and dimensions: embedding.ts).
// Only embeds chunks that have no embedding yet, or one from a different model,
// so a failed run can simply be rerun and continues where it stopped.
import { embed, EMBEDDING_MODEL } from "../lib/embedding.ts";
import { supabase } from "../lib/supabase.ts";

const DOCUMENT_ID = "maths-for-ml";
const BATCH_SIZE = 64; // texts per API request
const PAGE_SIZE = 1000; // Supabase returns at most 1,000 rows per request

// Chunks still to embed, read page by page.
const todo: { id: string; text: string }[] = [];
for (let from = 0; ; from += PAGE_SIZE) {
  const { data, error } = await supabase
    .from("chunks")
    .select("id, text")
    .eq("document_id", DOCUMENT_ID)
    .or(`embedding.is.null,embedding_model.neq.${EMBEDDING_MODEL}`)
    .order("id")
    .range(from, from + PAGE_SIZE - 1);
  if (error) throw new Error(`read chunks failed: ${error.message}`);
  todo.push(...data);
  if (data.length < PAGE_SIZE) break;
}

let tokens = 0;
for (let start = 0; start < todo.length; start += BATCH_SIZE) {
  const batch = todo.slice(start, start + BATCH_SIZE);
  const result = await embed(batch.map((c) => c.text));
  tokens += result.tokens;

  // One update per chunk; pgvector reads '[0.1,0.2,…]', which JSON.stringify writes.
  const updates = await Promise.all(
    batch.map((c, i) =>
      supabase
        .from("chunks")
        .update({ embedding: JSON.stringify(result.vectors[i]), embedding_model: EMBEDDING_MODEL })
        .eq("id", c.id)
    )
  );
  const failed = updates.find((u) => u.error);
  if (failed?.error) throw new Error(`update embeddings failed: ${failed.error.message}`);
  console.log(`embedded ${Math.min(start + BATCH_SIZE, todo.length)} / ${todo.length}`);
}

const { count: embedded } = await supabase
  .from("chunks")
  .select("id", { count: "exact", head: true })
  .eq("document_id", DOCUMENT_ID)
  .not("embedding", "is", null);
console.log({ embedded, embeddedThisRun: todo.length, tokensBilled: tokens, model: EMBEDDING_MODEL });
