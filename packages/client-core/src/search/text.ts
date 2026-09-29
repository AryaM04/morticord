// The text rules of the local search: word folding (case and diacritics),
// the query syntax with its filters, and the result snippet. Pure
// functions, no storage. See docs/concepts/search.md.

/** A word longer than this is cut to this length, in the index and in a query. */
export const MAX_TOKEN_LENGTH = 32;
/** A message gives at most this many different words to the index. */
export const MAX_TOKENS_PER_MESSAGE = 200;

const WORD_PATTERN = /[\p{L}\p{N}]+/gu;

/** Lower case, with diacritics removed: "Élan" and "elan" fold to the same text. */
export function foldText(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase();
}

/** The different folded words of a text, in order. A link counts as its words ("example", "com"). */
export function tokenize(text: string): string[] {
  const seen = new Set<string>();
  for (const match of foldText(text).matchAll(WORD_PATTERN)) {
    seen.add(match[0].slice(0, MAX_TOKEN_LENGTH));
    if (seen.size >= MAX_TOKENS_PER_MESSAGE) {
      break;
    }
  }
  return [...seen];
}

export type HasFilter = "file" | "link";

export interface ParsedSearchQuery {
  /** Folded words. A message must have each of them. */
  terms: string[];
  /** Names after `from:` (without "@"), folded. */
  from: string[];
  /** Channel names after `in:` (without "#"), folded. */
  in: string[];
  has: HasFilter[];
}

/**
 * Read a query such as `hello from:@ana in:#general has:link`. A filter
 * that is not known stays as plain words. Names are folded like words.
 */
export function parseSearchQuery(query: string): ParsedSearchQuery {
  const parsed: ParsedSearchQuery = { terms: [], from: [], in: [], has: [] };
  const words: string[] = [];
  for (const part of query.trim().split(/\s+/)) {
    const match = /^(from|in|has):(.+)$/i.exec(part);
    const kind = match?.[1]!.toLowerCase();
    const value = match ? foldText(match[2]!) : "";
    if (kind === "from" && value.replace(/^@/, "")) {
      parsed.from.push(value.replace(/^@/, ""));
    } else if (kind === "in" && value.replace(/^#/, "")) {
      parsed.in.push(value.replace(/^#/, ""));
    } else if (kind === "has" && (value === "file" || value === "link")) {
      if (!parsed.has.includes(value)) {
        parsed.has.push(value);
      }
    } else if (part) {
      words.push(part);
    }
  }
  parsed.terms = tokenize(words.join(" "));
  return parsed;
}

/** True when the parsed query asks for nothing. */
export function isEmptyQuery(query: ParsedSearchQuery): boolean {
  return query.terms.length === 0 && query.from.length === 0 && query.in.length === 0 && query.has.length === 0;
}

/**
 * A short part of `body` around the first word that matches a term, for
 * the result list. The text is not folded, so it shows as it was sent.
 */
export function makeSnippet(body: string, terms: string[], maxLength = 140): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= maxLength) {
    return flat;
  }
  let at = 0;
  if (terms.length > 0) {
    for (const match of flat.matchAll(WORD_PATTERN)) {
      if (terms.includes(foldText(match[0]).slice(0, MAX_TOKEN_LENGTH))) {
        at = match.index ?? 0;
        break;
      }
    }
  }
  const start = Math.max(0, Math.min(at - Math.floor(maxLength / 3), flat.length - maxLength));
  const text = flat.slice(start, start + maxLength);
  return `${start > 0 ? "…" : ""}${text}${start + maxLength < flat.length ? "…" : ""}`;
}
