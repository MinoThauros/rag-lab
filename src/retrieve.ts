// Hybrid retrieval: vector similarity + keyword match, merged with reciprocal
// rank fusion (RRF). Shared by search.ts (inspect results) and ask.ts (answer).
import pg from "pg";
import { embed } from "./embedding.ts";

const CANDIDATES = 20; // taken from each search before merging
const RRF_K = 60; // standard RRF constant: dampens the weight of top ranks

export type RetrievedChunk = {
  id: string;
  section: string;
  pages: number[];
  kind: "text" | "figure";
  text: string;
  tokens: number;
  semantic_rank: string | null;
  keyword_rank: string | null;
  score: string;
};

export async function retrieve(
  db: pg.Pool | pg.Client,
  question: string,
  topK: number
): Promise<RetrievedChunk[]> {
  const {
    vectors: [questionVector],
  } = await embed([question]);

  const { rows } = await db.query<RetrievedChunk>(
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
     select c.id,
            array_to_string(c.heading_path, ' › ') as section,
            c.pages, c.kind, c.text, c.tokens,
            s.rank as semantic_rank, k.rank as keyword_rank,
            round((coalesce(1.0 / ($5 + s.rank), 0) + coalesce(1.0 / ($5 + k.rank), 0))::numeric, 4) as score
       from semantic s
       full outer join keyword k on k.id = s.id
       join chunks c on c.id = coalesce(s.id, k.id)
      order by score desc
      limit $6`,
    [JSON.stringify(questionVector), "maths-for-ml", question, CANDIDATES, RRF_K, topK]
  );
  return rows;
}
