// A small fuzzy matcher for the quick switcher. The letters of the query must
// appear in the text in the same order. A higher score is a better match.

/** The score of `query` in `text`, or null when the text does not match. An empty query matches with 0. */
export function fuzzyScore(query: string, text: string): number | null {
  const needle = query.toLowerCase().replace(/\s+/g, "");
  if (needle === "") return 0;
  const haystack = text.toLowerCase();
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const letter of needle) {
    const index = haystack.indexOf(letter, from);
    if (index === -1) return null;
    // A run of letters, a match at the start of a word, and an early match score higher.
    if (index === previous + 1) score += 5;
    if (index === 0 || /[\s#\-_@]/.test(haystack[index - 1]!)) score += 3;
    score += 1 - index * 0.01;
    previous = index;
    from = index + letter.length;
  }
  // A shorter text is a closer match.
  return score - haystack.length * 0.02;
}

/** Keep the items that match, best first. Items with equal scores keep their order. */
export function fuzzyFilter<T>(query: string, items: readonly T[], textOf: (item: T) => string, limit: number): T[] {
  const scored: Array<{ item: T; score: number }> = [];
  for (const item of items) {
    const score = fuzzyScore(query, textOf(item));
    if (score !== null) scored.push({ item, score });
  }
  if (query.trim() !== "") scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((entry) => entry.item);
}
