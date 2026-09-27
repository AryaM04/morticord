import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "./markdown.js";

describe("parseInline", () => {
  it("parses bold, italic, underline and strike", () => {
    expect(parseInline("**bold**")).toEqual([{ type: "bold", children: [{ type: "text", text: "bold" }] }]);
    expect(parseInline("*italic*")).toEqual([{ type: "italic", children: [{ type: "text", text: "italic" }] }]);
    expect(parseInline("__under__")).toEqual([{ type: "underline", children: [{ type: "text", text: "under" }] }]);
    expect(parseInline("~~strike~~")).toEqual([{ type: "strike", children: [{ type: "text", text: "strike" }] }]);
  });

  it("parses inline code and does not format its content", () => {
    expect(parseInline("`**not bold**`")).toEqual([{ type: "code", text: "**not bold**" }]);
  });

  it("parses a spoiler mark", () => {
    expect(parseInline("||secret||")).toEqual([{ type: "spoiler", children: [{ type: "text", text: "secret" }] }]);
  });

  it("nests marks, such as bold containing italic", () => {
    expect(parseInline("**bold *and italic* still bold**")).toEqual([
      {
        type: "bold",
        children: [
          { type: "text", text: "bold " },
          { type: "italic", children: [{ type: "text", text: "and italic" }] },
          { type: "text", text: " still bold" },
        ],
      },
    ]);
  });

  it("autolinks http and https only, never javascript: or other schemes", () => {
    expect(parseInline("see https://example.com/x now")).toEqual([
      { type: "text", text: "see " },
      { type: "link", url: "https://example.com/x" },
      { type: "text", text: " now" },
    ]);
    expect(parseInline("javascript:alert(1)")).toEqual([{ type: "text", text: "javascript:alert(1)" }]);
    expect(parseInline("ftp://example.com")).toEqual([{ type: "text", text: "ftp://example.com" }]);
  });

  it("renders a mention as a mention node, by numeric id only", () => {
    expect(parseInline("hi <@123>")).toEqual([
      { type: "text", text: "hi " },
      { type: "mention", userId: "123" },
    ]);
    // Not a valid mention: no digits.
    expect(parseInline("<@abc>")).toEqual([{ type: "text", text: "<@abc>" }]);
  });

  it("falls back to literal text for an unclosed marker, without throwing", () => {
    expect(() => parseInline("**bold with no close")).not.toThrow();
    expect(parseInline("**bold with no close")).toEqual([{ type: "text", text: "**bold with no close" }]);
  });

  it("never turns an <img onerror> attempt into anything but a text node", () => {
    const input = '<img src=x onerror=alert(1)>';
    const nodes = parseInline(input);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toEqual({ type: "text", text: input });
    // No node type in the whole tree is ever "html" or similar: only the types below exist.
    for (const node of nodes) {
      expect(["text", "bold", "italic", "underline", "strike", "spoiler", "code", "link", "mention"]).toContain(node.type);
    }
  });

  it("never executes a script tag: it stays literal text", () => {
    const input = "<script>alert(document.cookie)</script>";
    expect(parseInline(input)).toEqual([{ type: "text", text: input }]);
  });

  it("treats a javascript: URL inside a mention-like or link-like string as plain text", () => {
    const input = "[click me](javascript:alert(1))";
    const nodes = parseInline(input);
    expect(nodes.every((n) => n.type === "text")).toBe(true);
  });

  it("handles deeply nested and unclosed markers without throwing or hanging", () => {
    const pathological = "*".repeat(2000) + "a" + "*".repeat(2000);
    expect(() => parseInline(pathological)).not.toThrow();
  });

  it("finishes fast on a 4000-character pathological input", () => {
    const input = "**".repeat(1000) + "<img onerror=x>".repeat(100) + "||".repeat(500);
    const start = performance.now();
    expect(() => parseInline(input.slice(0, 4000))).not.toThrow();
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });
});

describe("parseMarkdown", () => {
  it("splits a code block out on its own, with no inline formatting applied inside it", () => {
    const blocks = parseMarkdown("before\n```\n**not bold**\n```\nafter");
    expect(blocks).toEqual([
      { type: "paragraph", children: [{ type: "text", text: "before" }] },
      { type: "codeblock", text: "**not bold**" },
      { type: "paragraph", children: [{ type: "text", text: "after" }] },
    ]);
  });

  it("groups consecutive quote lines into one quote block", () => {
    const blocks = parseMarkdown("> line one\n> line two\nnot quoted");
    expect(blocks).toEqual([
      { type: "quote", children: [{ type: "text", text: "line one\nline two" }] },
      { type: "paragraph", children: [{ type: "text", text: "not quoted" }] },
    ]);
  });

  it("never throws on an unclosed code fence", () => {
    expect(() => parseMarkdown("before ```still open")).not.toThrow();
  });

  it("clamps to the 4000-character message limit", () => {
    const blocks = parseMarkdown("a".repeat(5000));
    const totalChars = JSON.stringify(blocks).length;
    expect(totalChars).toBeLessThan(6000);
  });
});
