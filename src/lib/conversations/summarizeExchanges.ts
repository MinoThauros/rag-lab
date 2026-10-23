// Rolling summary: fold older exchanges into the running summary.
import { SUMMARY_SYSTEM_PROMPT } from "../../constants/prompts.ts";
import type { Turn } from "../../types/conversation.ts";
import { formatTranscript } from "../../utils/transcript.ts";
import { complete } from "../qwen.ts";

export async function summarizeExchanges(currentSummary: string, exchanges: Turn[]): Promise<string> {
  return complete(
    SUMMARY_SYSTEM_PROMPT,
    [
      `Current summary:\n${currentSummary || "(empty)"}`,
      `Exchanges to fold in:\n${formatTranscript(exchanges)}`,
    ].join("\n\n"),
    400
  );
}
