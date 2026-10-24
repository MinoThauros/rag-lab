// The one place that defines how text becomes a vector. Chunks and questions
// must be embedded identically, or their vectors aren't comparable.
import { azureOpenAI } from "./azureOpenAI.ts";

export const DIMENSIONS = 1536;
export const EMBEDDING_MODEL = `text-embedding-3-large@${DIMENSIONS}`;

export async function embed(texts: string[]) {
  const response = await azureOpenAI.embeddings.create({
    model: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT!,
    input: texts,
    dimensions: DIMENSIONS,
  });
  return { vectors: response.data.map((d) => d.embedding), tokens: response.usage.total_tokens };
}
