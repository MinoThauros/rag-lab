// Pure scoring for the rewrite eval.
import type { RewriteCase } from "../types/rewriteEval.ts";

const has = (text: string, term: string) => text.toLowerCase().includes(term.toLowerCase());

// The rewrite names the right topic(s) and doesn't drag in the ones it shouldn't.
export const rewriteHitsTerms = (c: RewriteCase, rewrite: string) =>
  c.must_mention.every((group) => group.some((term) => has(rewrite, term))) &&
  !c.must_not_mention.some((term) => has(rewrite, term));

// Sections come back as "4 Matrix Decompositions › 4.2 Eigenvalues and Eigenvectors › …";
// "4.2" matches that heading and anything under it.
export const sectionMatches = (section: string, expected: string) =>
  section.split(" › ").some((heading) => heading.startsWith(`${expected} `));

// 1-based rank of the first retrieved chunk in an expected section, or null.
export const firstHitRank = (c: RewriteCase, sections: string[]) => {
  const index = sections.findIndex((s) => c.expected_sections.some((e) => sectionMatches(s, e)));
  return index === -1 ? null : index + 1;
};

// Unchanged up to case, whitespace and trailing punctuation.
const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, " ").replace(/[?.!\s]+$/, "").trim();
export const isUnchanged = (message: string, rewrite: string) => normalize(message) === normalize(rewrite);
