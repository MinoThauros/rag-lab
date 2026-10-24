import type { Turn } from "./conversation.ts";

export type RewriteCategory =
  | "pronoun"
  | "implicit_topic"
  | "two_referents"
  | "topic_change"
  | "already_standalone";

// What a case expects; shared by the draft and the built case.
type CaseSpec = {
  id: string;
  category: RewriteCategory;
  split: "dev" | "heldout"; // heldout: never used to tune prompts or build training data
  difficulty: "easy" | "hard"; // hard: long threads (summary in play), referents only in answers
  message: string; // the latest user message, as typed
  must_mention: string[][]; // every group needs one of its terms (case-insensitive)
  must_not_mention: string[]; // e.g. the previous topic, for a topic change
  expected_sections: string[]; // section numbers like "4.2"; subsections count
};

// Hand-written: user turns only. `standalone` is what the history turn is answered
// from, for follow-ups inside the history itself. Cases with the same `thread` share
// one conversation, answered once, so their endings can be compared fairly.
export type DraftCase = CaseSpec & { thread?: string; history: { user: string; standalone?: string }[] };

// Built once and frozen: the assistant turns and the rolling summary come from the
// pipeline, the reference rewrite from a frontier model. Runs only re-run the rewrite.
export type RewriteCase = CaseSpec & {
  summary: string; // exchanges older than the verbatim window, folded as the app does
  history: Turn[]; // the verbatim window
  reference: string;
  reference_model: string;
};
