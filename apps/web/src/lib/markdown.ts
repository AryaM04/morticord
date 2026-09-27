// A small, safe markdown parser. It turns message text into a plain data
// tree (never HTML), so the renderer (`Markdown.tsx`) can only ever put
// plain text into the DOM. This is what makes the format safe: there is
// no "raw HTML" node type, so a tag or script in a message can never run.
//
// Supported marks: **bold**, *italic*, __underline__, ~~strike~~,
// `inline code`, ```code block``` (its own block, no syntax highlight),
// "> quote" lines, ||spoiler||, autolinks (http/https only) and mentions
// (`<@userId>`).

export type InlineNode =
  | { type: "text"; text: string }
  | { type: "bold"; children: InlineNode[] }
  | { type: "italic"; children: InlineNode[] }
  | { type: "underline"; children: InlineNode[] }
  | { type: "strike"; children: InlineNode[] }
  | { type: "spoiler"; children: InlineNode[] }
  | { type: "code"; text: string }
  | { type: "link"; url: string }
  | { type: "mention"; userId: string };

export type BlockNode =
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "quote"; children: InlineNode[] }
  | { type: "codeblock"; text: string };

const MAX_BODY_LENGTH = 4000;

/** Parse one message body into a list of block nodes, ready to render. */
export function parseMarkdown(text: string): BlockNode[] {
  const clamped = text.length > MAX_BODY_LENGTH ? text.slice(0, MAX_BODY_LENGTH) : text;
  const blocks: BlockNode[] = [];
  for (const segment of splitCodeFences(clamped)) {
    if (segment.type === "code") {
      blocks.push({ type: "codeblock", text: segment.content.replace(/^\n/, "").replace(/\n$/, "") });
      continue;
    }
    blocks.push(...parseTextSegment(segment.content));
  }
  return blocks;
}

function splitCodeFences(text: string): Array<{ type: "text" | "code"; content: string }> {
  const segments: Array<{ type: "text" | "code"; content: string }> = [];
  const fence = "```";
  let cursor = 0;
  while (cursor < text.length) {
    const openIndex = text.indexOf(fence, cursor);
    if (openIndex === -1) {
      segments.push({ type: "text", content: text.slice(cursor) });
      break;
    }
    if (openIndex > cursor) {
      // A code block is its own block: drop the single newline that
      // separates it from the text before it, so that text does not
      // gain a stray trailing blank line.
      const end = text[openIndex - 1] === "\n" ? openIndex - 1 : openIndex;
      if (end > cursor) {
        segments.push({ type: "text", content: text.slice(cursor, end) });
      }
    }
    const closeIndex = text.indexOf(fence, openIndex + fence.length);
    if (closeIndex === -1) {
      // No closing fence: the rest of the message is plain text, marker included.
      segments.push({ type: "text", content: text.slice(openIndex) });
      break;
    }
    segments.push({ type: "code", content: text.slice(openIndex + fence.length, closeIndex) });
    cursor = closeIndex + fence.length;
    if (text[cursor] === "\n") {
      // Likewise, drop the single newline separating the code block from what follows.
      cursor += 1;
    }
  }
  return segments;
}

function parseTextSegment(text: string): BlockNode[] {
  const blocks: BlockNode[] = [];
  const lines = text.split("\n");
  let paragraphLines: string[] = [];

  const flushParagraph = (): void => {
    if (paragraphLines.length === 0) {
      return;
    }
    const joined = paragraphLines.join("\n");
    paragraphLines = [];
    if (joined.length === 0) {
      return;
    }
    blocks.push({ type: "paragraph", children: parseInline(joined) });
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (/^>\s?/.test(line)) {
      flushParagraph();
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) {
        quoteLines.push(lines[i]!.replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push({ type: "quote", children: parseInline(quoteLines.join("\n")) });
      continue;
    }
    paragraphLines.push(line);
    i += 1;
  }
  flushParagraph();
  return blocks;
}

interface PairedMark {
  marker: string;
  node: (children: InlineNode[]) => InlineNode;
}

// Checked longest-marker-first, so "**" is tried before a lone "*".
const PAIRED_MARKS: PairedMark[] = [
  { marker: "~~", node: (children) => ({ type: "strike", children }) },
  { marker: "||", node: (children) => ({ type: "spoiler", children }) },
  { marker: "__", node: (children) => ({ type: "underline", children }) },
  { marker: "**", node: (children) => ({ type: "bold", children }) },
  { marker: "*", node: (children) => ({ type: "italic", children }) },
];

const MENTION_RE = /^<@(\d+)>/;
const AUTOLINK_RE = /^https?:\/\/[^\s<>]+/;

/** Parse inline marks inside one block of text. Never throws, and never runs unbounded time. */
export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let buffer = "";
  let i = 0;

  const flush = (): void => {
    if (buffer.length > 0) {
      nodes.push({ type: "text", text: buffer });
      buffer = "";
    }
  };

  while (i < text.length) {
    const mention = MENTION_RE.exec(text.slice(i));
    if (mention && mention.index === 0) {
      flush();
      nodes.push({ type: "mention", userId: mention[1]! });
      i += mention[0].length;
      continue;
    }

    const link = AUTOLINK_RE.exec(text.slice(i));
    if (link && link.index === 0) {
      flush();
      nodes.push({ type: "link", url: link[0] });
      i += link[0].length;
      continue;
    }

    if (text[i] === "`") {
      const closeIndex = text.indexOf("`", i + 1);
      if (closeIndex !== -1) {
        flush();
        nodes.push({ type: "code", text: text.slice(i + 1, closeIndex) });
        i = closeIndex + 1;
        continue;
      }
    }

    const paired = matchPairedMark(text, i);
    if (paired) {
      flush();
      nodes.push(paired.node(parseInline(paired.inner)));
      i = paired.next;
      continue;
    }

    buffer += text[i];
    i += 1;
  }

  flush();
  return nodes;
}

function matchPairedMark(text: string, i: number): { node: (children: InlineNode[]) => InlineNode; inner: string; next: number } | null {
  for (const mark of PAIRED_MARKS) {
    if (!text.startsWith(mark.marker, i)) {
      continue;
    }
    // A lone "*" (italic) must never re-try at a position where "**"
    // (bold) already started but failed to find its own close: that
    // would wrongly pair the two "*" of a failed bold as an empty
    // italic instead of leaving them as literal text.
    if (mark.marker === "*" && text.startsWith("**", i)) {
      continue;
    }
    const closeIndex = text.indexOf(mark.marker, i + mark.marker.length);
    if (closeIndex === -1) {
      continue;
    }
    return { node: mark.node, inner: text.slice(i + mark.marker.length, closeIndex), next: closeIndex + mark.marker.length };
  }
  return null;
}
