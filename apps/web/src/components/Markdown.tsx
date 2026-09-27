// Renders a message body with the small markdown format from
// `lib/markdown.ts`. It only ever renders text nodes and a small set of
// known elements: it never uses `dangerouslySetInnerHTML`, so nothing in
// a message body can inject HTML or run script.
import { useState } from "react";
import { parseInline, parseMarkdown, type BlockNode, type InlineNode } from "../lib/markdown.js";

export interface MarkdownProps {
  text: string;
  /** Display name lookup for a mention pill. Falls back to the raw id. */
  getDisplayName?: (userId: string) => string | undefined;
  /** The signed-in user's id, to highlight a mention of them. */
  selfUserId?: string | null;
}

function withLineBreaks(text: string, key: string): React.ReactNode[] {
  return text.split("\n").flatMap((line, index) => (index === 0 ? [line] : [<br key={`${key}-br-${index}`} />, line]));
}

function Spoiler({ children }: { children: React.ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={() => setRevealed(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          setRevealed(true);
        }
      }}
      className={revealed ? "md-spoiler md-spoiler-revealed" : "md-spoiler"}
      aria-label={revealed ? undefined : "Show the hidden text."}
    >
      {children}
    </span>
  );
}

function renderInline(nodes: InlineNode[], props: MarkdownProps, keyPrefix: string): React.ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (node.type) {
      case "text":
        return <span key={key}>{withLineBreaks(node.text, key)}</span>;
      case "bold":
        return <strong key={key}>{renderInline(node.children, props, key)}</strong>;
      case "italic":
        return <em key={key}>{renderInline(node.children, props, key)}</em>;
      case "underline":
        return <u key={key}>{renderInline(node.children, props, key)}</u>;
      case "strike":
        return <s key={key}>{renderInline(node.children, props, key)}</s>;
      case "spoiler":
        return <Spoiler key={key}>{renderInline(node.children, props, key)}</Spoiler>;
      case "code":
        return <code key={key}>{node.text}</code>;
      case "link":
        return (
          <a key={key} href={node.url} target="_blank" rel="noopener noreferrer">
            {node.url}
          </a>
        );
      case "mention": {
        const name = props.getDisplayName?.(node.userId) ?? node.userId;
        const isSelf = props.selfUserId != null && node.userId === props.selfUserId;
        return (
          <span key={key} className={isSelf ? "md-mention md-mention-self" : "md-mention"}>
            @{name}
          </span>
        );
      }
      default:
        return null;
    }
  });
}

function renderBlock(block: BlockNode, props: MarkdownProps, key: string): React.ReactNode {
  switch (block.type) {
    case "paragraph":
      return <p key={key}>{renderInline(block.children, props, key)}</p>;
    case "quote":
      return <blockquote key={key}>{renderInline(block.children, props, key)}</blockquote>;
    case "codeblock":
      return (
        <pre key={key}>
          <code>{block.text}</code>
        </pre>
      );
    default:
      return null;
  }
}

export function Markdown(props: MarkdownProps) {
  const blocks = parseMarkdown(props.text);
  return <>{blocks.map((block, index) => renderBlock(block, props, `b-${index}`))}</>;
}

/** Render one line of inline-only markdown (no block structure), for a reply preview. */
export function MarkdownInline(props: MarkdownProps) {
  const nodes = parseInline(props.text.replace(/\n/g, " "));
  return <>{renderInline(nodes, props, "i")}</>;
}
