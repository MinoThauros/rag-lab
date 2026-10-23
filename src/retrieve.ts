// Hybrid retrieval: vector similarity + keyword match, merged with reciprocal
// rank fusion (RRF), via the hybrid_search() SQL function (see migrations).
// Shared by search.ts (inspect results) and answer.ts (answer).
import { embed } from "./embedding.ts";
import { supabase } from "./supabase.ts";

const DOCUMENT_ID = "maths-for-ml";

export type RetrievedChunk = {
  id: string;
  section: string;
  pages: number[];
  kind: "text" | "figure";
  text: string;
  tokens: number;
  semantic_rank: number | null;
  keyword_rank: number | null;
  score: number;
};

export async function retrieve(question: string, topK: number): Promise<RetrievedChunk[]> {
  const {
    vectors: [questionVector],
  } = await embed([question]);

  const { data, error } = await supabase.rpc("hybrid_search", {
    query_embedding: JSON.stringify(questionVector),
    query_text: question,
    filter_document_id: DOCUMENT_ID,
    match_count: topK,
  });
  if (error) throw new Error(`hybrid_search failed: ${error.message}`);
  return data as RetrievedChunk[];
}
