// The answering model: any OpenAI-compatible endpoint (here vLLM serving Qwen3
// on the GPU node). Shared by answer.ts and conversation.ts (rewrite, summary).
import OpenAI from "openai";

export const qwen = new OpenAI({
  baseURL: process.env.QWEN_BASE_URL, // http://<gpu-host>:8000/v1, over Tailscale
  apiKey: "none", // vLLM has no API key yet
});

export const QWEN_MODEL = process.env.QWEN_MODEL!; // Qwen/Qwen3-8B-FP8

// Short, deterministic call (rewrite, summary): no streaming, no <think> reasoning.
export async function complete(system: string, user: string, maxTokens: number): Promise<string> {
  const response = await qwen.chat.completions.create({
    model: QWEN_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0,
    max_tokens: maxTokens,
    chat_template_kwargs: { enable_thinking: false }, // vLLM-specific
  } as OpenAI.ChatCompletionCreateParamsNonStreaming);
  return response.choices[0].message.content?.trim() ?? "";
}
