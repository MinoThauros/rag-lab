export const ANSWER_SYSTEM_PROMPT = [
  "You answer questions about the user's documents.",
  "Answer the latest question; earlier turns are background only, and the topic may have changed.",
  "Use only the numbered sources provided. Cite them inline like [1] or [2][3].",
  'If the sources do not contain the answer, say: "I don\'t know from the provided sources."',
  "Write mathematics in LaTeX.",
].join(" ");

export const REWRITE_SYSTEM_PROMPT = [
  "Rewrite the user's latest message as a standalone question about their documents:",
  "one that can be understood without the conversation. Use the conversation to fill in",
  'anything left implicit, such as "it", "that" or an unstated topic ("an example?").',
  "If it is already standalone, return it unchanged. Output only the question.",
].join(" ");

export const SUMMARY_MAX_WORDS = 200;

export const SUMMARY_SYSTEM_PROMPT = [
  "Update the running summary of this study session.",
  "Keep: what the user is trying to learn, what has been established",
  "(definitions, results, worked examples with their numbers), and open questions.",
  `Drop small talk. Under ${SUMMARY_MAX_WORDS} words. Output only the summary.`,
].join(" ");
