// Azure OpenAI (Foundry) through the OpenAI SDK and Azure's v1 endpoint, as in
// PostgresBackend's openAiClient. Used for embeddings and the rewrite eval's reference model.
import OpenAI from "openai";

export const azureOpenAI = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT!.replace(/\/+$/, "")}/openai/v1/`,
  maxRetries: 5, // the SDK backs off and retries on rate limits (429)
});
