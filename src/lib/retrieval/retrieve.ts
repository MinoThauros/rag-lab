// Hybrid retrieval: vector similarity + keyword match, merged with reciprocal
// rank fusion (RRF), via the hybrid_search() SQL function (see migrations).
// Searches all of the owner's documents, or only `documentIds` when given.
import { embed } from "../embedding.ts";
import { supabase } from "../supabase.ts";

export type RetrievedChunk = {
  id: string;
  document_id: string;
  section: string;
  pages: number[];
  kind: "text" | "figure";
  text: string;
  tokens: number;
  semantic_rank: number | null;
  keyword_rank: number | null;
  score: number;
};

export type RetrievalScope = { ownerId: string; documentIds?: string[] };

export async function retrieve(
  question: string,
  topK: number,
  scope: RetrievalScope
): Promise<RetrievedChunk[]> {
  const {
    vectors: [questionVector],
  } = await embed([question]);

  const { data, error } = await supabase.rpc("hybrid_search", {
    query_embedding: JSON.stringify(questionVector),
    query_text: question,
    owner: scope.ownerId,
    match_count: topK,
    document_ids: scope.documentIds ?? null,
  });
  if (error) throw new Error(`hybrid_search failed: ${error.message}`);
  return data as RetrievedChunk[];
}
