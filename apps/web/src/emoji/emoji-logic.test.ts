import { describe, expect, it } from "vitest";
import {
  MAX_RECENT_EMOJI,
  addRecentEmoji,
  emojiInCategory,
  loadRecentEmoji,
  recentEmojiRecords,
  saveRecentEmoji,
  searchEmoji,
  type EmojiRecord,
} from "./emoji-logic.js";

const SAMPLE: EmojiRecord[] = [
  { e: "😀", n: "grinning face", c: "Smileys & Emotion" },
  { e: "😂", n: "face with tears of joy", c: "Smileys & Emotion" },
  { e: "🐶", n: "dog face", c: "Animals & Nature" },
  { e: "🍕", n: "pizza", c: "Food & Drink" },
];

describe("searchEmoji", () => {
  it("returns the whole list for an empty term", () => {
    expect(searchEmoji(SAMPLE, "")).toEqual(SAMPLE);
    expect(searchEmoji(SAMPLE, "   ")).toEqual(SAMPLE);
  });

  it("matches a substring of the name, case-insensitively", () => {
    expect(searchEmoji(SAMPLE, "FACE").map((r) => r.e)).toEqual(["😀", "😂", "🐶"]);
  });

  it("matches nothing when the term is not in any name", () => {
    expect(searchEmoji(SAMPLE, "xyz")).toEqual([]);
  });

  it("trims surrounding whitespace before matching", () => {
    expect(searchEmoji(SAMPLE, "  pizza  ").map((r) => r.e)).toEqual(["🍕"]);
  });
});

describe("emojiInCategory", () => {
  it("keeps dataset order and filters to one category", () => {
    expect(emojiInCategory(SAMPLE, "Smileys & Emotion").map((r) => r.e)).toEqual(["😀", "😂"]);
    expect(emojiInCategory(SAMPLE, "Animals & Nature").map((r) => r.e)).toEqual(["🐶"]);
  });
});

describe("addRecentEmoji", () => {
  it("puts a new emoji at the front", () => {
    expect(addRecentEmoji([], "😀")).toEqual(["😀"]);
    expect(addRecentEmoji(["😀"], "🐶")).toEqual(["🐶", "😀"]);
  });

  it("moves an already-present emoji to the front instead of duplicating it", () => {
    expect(addRecentEmoji(["😀", "🐶", "🍕"], "🐶")).toEqual(["🐶", "😀", "🍕"]);
  });

  it("caps the list at the maximum length", () => {
    const full = Array.from({ length: MAX_RECENT_EMOJI }, (_, i) => `e${i}`);
    const next = addRecentEmoji(full, "new");
    expect(next.length).toBe(MAX_RECENT_EMOJI);
    expect(next[0]).toBe("new");
    expect(next).not.toContain(`e${MAX_RECENT_EMOJI - 1}`);
  });
});

describe("recentEmojiRecords", () => {
  it("resolves stored emoji to their records, in stored order", () => {
    expect(recentEmojiRecords(SAMPLE, ["🍕", "😀"]).map((r) => r.n)).toEqual(["pizza", "grinning face"]);
  });

  it("skips an emoji no longer in the dataset", () => {
    expect(recentEmojiRecords(SAMPLE, ["🍕", "👽"]).map((r) => r.e)).toEqual(["🍕"]);
  });
});

/** A minimal in-memory `Storage`, for a test environment with no real one (plain Node has none). */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

describe("loadRecentEmoji / saveRecentEmoji", () => {
  it("round-trips through storage when storage works", () => {
    const realLocalStorage = globalThis.localStorage;
    globalThis.localStorage = fakeStorage();
    saveRecentEmoji(["😀", "🐶"]);
    expect(loadRecentEmoji()).toEqual(["😀", "🐶"]);
    globalThis.localStorage = realLocalStorage;
  });

  it("returns an empty list when storage is unavailable", () => {
    const realLocalStorage = globalThis.localStorage;
    // @ts-expect-error -- simulate an environment with no localStorage (private mode, or a non-browser test run).
    delete globalThis.localStorage;
    expect(loadRecentEmoji()).toEqual([]);
    expect(() => saveRecentEmoji(["😀"])).not.toThrow();
    globalThis.localStorage = realLocalStorage;
  });
});
