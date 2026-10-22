// Fills chunks.embedding for one document (model and dimensions: embedding.ts).
// Only embeds chunks that have no embedding yet, or one from a different model,
// so a failed run can simply be rerun and continues where it stopped.
import pg from "pg";
import { embed, EMBEDDING_MODEL } from "./embedding.ts";

const DOCUMENT_ID = "maths-for-ml";
const BATCH_SIZE = 64; // texts per API request

const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

const { rows: todo } = await db.query<{ id: string; text: string }>(
  `select id, text from chunks
    where document_id = $1 and (embedding is null or embedding_model is distinct from $2)
    order by id`,
  [DOCUMENT_ID, EMBEDDING_MODEL]
);

let tokens = 0;
for (let start = 0; start < todo.length; start += BATCH_SIZE) {
  const batch = todo.slice(start, start + BATCH_SIZE);
  const result = await embed(batch.map((c) => c.text));
  tokens += result.tokens;

  // pgvector reads '[0.1,0.2,…]', which is exactly what JSON.stringify writes.
  await db.query(
    `update chunks c
        set embedding = v.embedding::extensions.vector, embedding_model = $3
       from unnest($1::text[], $2::text[]) as v(id, embedding)
      where c.id = v.id`,
    [batch.map((c) => c.id), result.vectors.map((v) => JSON.stringify(v)), EMBEDDING_MODEL]
  );
  console.log(`embedded ${Math.min(start + BATCH_SIZE, todo.length)} / ${todo.length}`);
}

const { rows } = await db.query(
  "select count(embedding)::int as embedded, count(*)::int as total from chunks where document_id = $1",
  [DOCUMENT_ID]
);
console.log({ ...rows[0], tokensBilled: tokens, model: EMBEDDING_MODEL });
await db.end();
