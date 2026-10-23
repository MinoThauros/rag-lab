// Source numbers an answer cites ("[1]", "[2][3]"), deduplicated and in order,
// keeping only numbers that exist among the sources sent.
export const extractCitations = (text: string, sourceCount: number): number[] =>
  [...new Set([...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))]
    .filter((n) => n >= 1 && n <= sourceCount)
    .sort((a, b) => a - b);
