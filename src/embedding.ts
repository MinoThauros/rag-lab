// The one place that defines how text becomes a vector. Chunks and questions
// must be embedded identically, or their vectors aren't comparable.
import OpenAI from "openai";

export const DIMENSIONS = 1536;
export const EMBEDDING_MODEL = `text-embedding-3-large@${DIMENSIONS}`;

const openai = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT!.replace(/\/+$/, "")}/openai/v1/`,
  maxRetries: 5, // the SDK backs off and retries on rate limits (429)
});

export async function embed(texts: string[]) {
  const response = await openai.embeddings.create({
    model: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT!,
    input: texts,
    dimensions: DIMENSIONS,
  });
  return { vectors: response.data.map((d) => d.embedding), tokens: response.usage.total_tokens };
}
