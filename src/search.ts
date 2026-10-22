// Hybrid search: vector similarity + keyword match, merged with reciprocal rank
// fusion (RRF). Usage: npm run search -- "what is an eigenvalue?"
import pg from "pg";
import { embed } from "./embedding.ts";

const question = process.argv.slice(2).join(" ");
const CANDIDATES = 20; // taken from each search before merging
const TOP_K = 5; // results shown
const RRF_K = 60; // standard RRF constant: dampens the weight of top ranks

const {
  vectors: [questionVector],
} = await embed([question]);

const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

const { rows } = await db.query(
  `with semantic as (
     select id, row_number() over (order by embedding <=> $1::extensions.vector) as rank
       from chunks
      where document_id = $2
      order by embedding <=> $1::extensions.vector
      limit $4
   ),
   keyword as (
     select id, row_number() over (order by ts_rank_cd(fts, query) desc) as rank
       from chunks, websearch_to_tsquery('english', $3) as query
      where document_id = $2 and fts @@ query
      order by ts_rank_cd(fts, query) desc
      limit $4
   )
   select array_to_string(c.heading_path, ' › ') as section,
          c.pages, c.kind,
          s.rank as semantic_rank, k.rank as keyword_rank,
          round((coalesce(1.0 / ($5 + s.rank), 0) + coalesce(1.0 / ($5 + k.rank), 0))::numeric, 4) as score,
          left(c.text, 160) as preview
     from semantic s
     full outer join keyword k on k.id = s.id
     join chunks c on c.id = coalesce(s.id, k.id)
    order by score desc
    limit $6`,
  [JSON.stringify(questionVector), "maths-for-ml", question, CANDIDATES, RRF_K, TOP_K]
);

console.log(`Q: ${question}`);
console.table(rows);
await db.end();
