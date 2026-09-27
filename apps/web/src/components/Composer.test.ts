import { describe, expect, it } from "vitest";
import { detectMentionQueryAt, extractMentions } from "./Composer.js";

describe("extractMentions", () => {
  it("extracts every <@id> token in order", () => {
    expect(extractMentions("hello <@1> and <@2>")).toEqual(["1", "2"]);
  });

  it("dedupes a repeated id, keeping only its first position", () => {
    expect(extractMentions("<@1> ping <@1> again <@2>")).toEqual(["1", "2"]);
  });

  it("returns an empty list when there is no mention", () => {
    expect(extractMentions("hello world")).toEqual([]);
  });

  it("counts a pasted token, not only ones inserted by the picker", () => {
    expect(extractMentions("pasted: <@42>")).toEqual(["42"]);
  });

  it("caps the result at 50 mentions", () => {
    const ids = Array.from({ length: 60 }, (_, i) => `<@${i}>`).join(" ");
    expect(extractMentions(ids)).toHaveLength(50);
  });
});

describe("detectMentionQueryAt", () => {
  it("finds a query right after a bare @ at the start of the text", () => {
    expect(detectMentionQueryAt("@al", 3)).toEqual({ start: 0, query: "al" });
  });

  it("finds a query after whitespace", () => {
    expect(detectMentionQueryAt("hello @al", 9)).toEqual({ start: 6, query: "al" });
  });

  it("finds an empty query right after a bare @", () => {
    expect(detectMentionQueryAt("hi @", 4)).toEqual({ start: 3, query: "" });
  });

  it("returns null when @ is not preceded by whitespace or the start", () => {
    expect(detectMentionQueryAt("email@example.com", 6)).toBeNull();
  });

  it("returns null once the query has whitespace in it", () => {
    expect(detectMentionQueryAt("hello @al ice", 13)).toBeNull();
  });

  it("returns null once a second @ appears in the query", () => {
    expect(detectMentionQueryAt("hello @al@ice", 13)).toBeNull();
  });

  it("returns null when there is no @ before the caret", () => {
    expect(detectMentionQueryAt("hello world", 5)).toBeNull();
  });

  it("only looks at text up to the caret, not the whole string", () => {
    expect(detectMentionQueryAt("@alice sent this", 3)).toEqual({ start: 0, query: "al" });
  });
});
