// One line on what an answer covered, stored with it. The rewriter reads these
// to know what each earlier turn was about without the full answers.
import { ANSWER_NOTE_SYSTEM_PROMPT } from "../../constants/prompts.ts";
import { complete } from "../qwen.ts";

export const noteAnswer = (answer: string) => complete(ANSWER_NOTE_SYSTEM_PROMPT, answer, 60);
