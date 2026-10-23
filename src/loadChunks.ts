// Loads the book's chunks (out/chunks.json) into Supabase: one `documents` row
// and its `chunks` rows. `fts` is filled by the chunks_set_fts trigger;
// embeddings are filled later by the embedding step.
//
// Replaces the document on every run (delete cascades to its chunks), so it's
// safe to rerun. Requests aren't one transaction: if a run fails midway, rerun it.
import { readFile } from "node:fs/promises";
import type { Chunk } from "./chunkBook.ts";
import { supabase } from "./supabase.ts";

const DOCUMENT = {
  id: "maths-for-ml",
  title: "Mathematics for Machine Learning",
  source_path: "data/maths_for_ML.pdf",
};
const BATCH_SIZE = 200;

const chunks = JSON.parse(
  await readFile(new URL("../out/chunks.json", import.meta.url), "utf8")
) as Chunk[];

const check = ({ error }: { error: { message: string } | null }, step: string) => {
  if (error) throw new Error(`${step} failed: ${error.message}`);
};

check(await supabase.from("documents").delete().eq("id", DOCUMENT.id), "delete document");
check(await supabase.from("documents").insert(DOCUMENT), "insert document");

for (let start = 0; start < chunks.length; start += BATCH_SIZE) {
  const rows = chunks.slice(start, start + BATCH_SIZE).map((c) => ({
    id: `${DOCUMENT.id}:${c.id}`,
    document_id: DOCUMENT.id,
    kind: c.kind,
    heading_path: c.headingPath,
    text: c.text,
    tokens: c.tokens,
    pages: c.pages,
    keywords: c.keywords,
    equation_numbers: c.equationNumbers,
    figure_number: c.figureNumber ?? null,
    source_ids: c.sourceIds,
  }));
  check(await supabase.from("chunks").insert(rows), `insert chunks ${start}`);
}

const count = async (filter: (q: any) => any) => {
  const { count, error } = await filter(
    supabase.from("chunks").select("id", { count: "exact", head: true }).eq("document_id", DOCUMENT.id)
  );
  if (error) throw new Error(error.message);
  return count;
};
console.log({
  document: DOCUMENT.id,
  chunks: await count((q) => q),
  with_fts: await count((q) => q.not("fts", "is", null)),
  figures: await count((q) => q.eq("kind", "figure")),
  with_embedding: await count((q) => q.not("embedding", "is", null)),
});
