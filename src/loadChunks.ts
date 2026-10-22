// Loads the book's chunks (out/chunks.json) into Supabase: one `documents` row
// and its `chunks` rows, with `fts` filled for keyword search. Embeddings are
// filled later by the embedding step.
//
// Runs in one transaction and replaces the document on every run (delete
// cascades to its chunks), so it's safe to rerun.
import { readFile } from "node:fs/promises";
import pg from "pg";
import type { Chunk } from "./chunkBook.ts";

const DOCUMENT = {
  id: "maths-for-ml",
  title: "Mathematics for Machine Learning",
  sourcePath: "data/maths_for_ML.pdf",
};
const BATCH_SIZE = 200;

const chunks = JSON.parse(
  await readFile(new URL("../out/chunks.json", import.meta.url), "utf8")
) as Chunk[];

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  // Encrypted, but the server certificate isn't verified. Fine for the lab; in
  // production, verify against Supabase's CA certificate instead.
  ssl: { rejectUnauthorized: false },
});
await client.connect();

try {
  await client.query("begin");

  await client.query("delete from documents where id = $1", [DOCUMENT.id]);
  await client.query(
    "insert into documents (id, title, source_path) values ($1, $2, $3)",
    [DOCUMENT.id, DOCUMENT.title, DOCUMENT.sourcePath]
  );

  const columns = [
    "id", "document_id", "kind", "heading_path", "text", "tokens", "pages",
    "keywords", "equation_numbers", "figure_number", "source_ids",
  ];
  for (let start = 0; start < chunks.length; start += BATCH_SIZE) {
    const batch = chunks.slice(start, start + BATCH_SIZE);
    const values = batch.flatMap((c) => [
      `${DOCUMENT.id}:${c.id}`, DOCUMENT.id, c.kind, c.headingPath, c.text, c.tokens, c.pages,
      c.keywords, c.equationNumbers, c.figureNumber ?? null, c.sourceIds,
    ]);
    // ($1, $2, …, $11), ($12, …), … one group of placeholders per row
    const rows = batch.map(
      (_, row) => `(${columns.map((_, col) => `$${row * columns.length + col + 1}`).join(", ")})`
    );
    await client.query(`insert into chunks (${columns.join(", ")}) values ${rows.join(", ")}`, values);
  }

  // Keyword search: heading path and margin keywords (weight A) rank above body text (B).
  await client.query(
    `update chunks set fts =
         setweight(to_tsvector('english', array_to_string(heading_path, ' ') || ' ' || array_to_string(keywords, ' ')), 'A')
      || setweight(to_tsvector('english', text), 'B')
     where document_id = $1`,
    [DOCUMENT.id]
  );

  await client.query("commit");
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  const { rows } = await client.query(
    `select count(*)::int as chunks,
            count(fts)::int as with_fts,
            count(*) filter (where kind = 'figure')::int as figures,
            count(embedding)::int as with_embedding
       from chunks where document_id = $1`,
    [DOCUMENT.id]
  );
  console.log({ document: DOCUMENT.id, ...rows[0] });
  await client.end();
}
