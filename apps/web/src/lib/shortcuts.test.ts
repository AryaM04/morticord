import { describe, expect, it } from "vitest";
import { adjacentId, matchShortcut, orderedTextChannelIds, shouldRunShortcut, type KeyInput } from "./shortcuts.js";
import { fuzzyFilter, fuzzyScore } from "./fuzzy.js";

function key(name: string, flags: Partial<KeyInput> = {}): KeyInput {
  return { key: name, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...flags };
}

describe("matchShortcut", () => {
  it("uses Ctrl on other systems and Cmd on a Mac", () => {
    expect(matchShortcut(key("k", { ctrlKey: true }), false)).toBe("quick-switcher");
    expect(matchShortcut(key("k", { metaKey: true }), false)).toBeNull();
    expect(matchShortcut(key("k", { metaKey: true }), true)).toBe("quick-switcher");
    expect(matchShortcut(key("k", { ctrlKey: true }), true)).toBeNull();
  });

  it("matches the letter shortcuts with a shifted letter", () => {
    expect(matchShortcut(key("M", { ctrlKey: true, shiftKey: true }), false)).toBe("toggle-mute");
    expect(matchShortcut(key("D", { ctrlKey: true, shiftKey: true }), false)).toBe("toggle-deafen");
    expect(matchShortcut(key("m", { ctrlKey: true }), false)).toBeNull();
    expect(matchShortcut(key("/", { ctrlKey: true }), false)).toBe("show-help");
  });

  it("matches the channel keys", () => {
    expect(matchShortcut(key("ArrowUp", { altKey: true }), false)).toBe("previous-channel");
    expect(matchShortcut(key("ArrowDown", { altKey: true }), false)).toBe("next-channel");
    expect(matchShortcut(key("ArrowUp", { altKey: true, shiftKey: true }), false)).toBe("previous-unread");
    expect(matchShortcut(key("ArrowDown", { altKey: true, shiftKey: true }), true)).toBe("next-unread");
    expect(matchShortcut(key("ArrowDown"), false)).toBeNull();
  });

  it("matches only a plain Escape", () => {
    expect(matchShortcut(key("Escape"), false)).toBe("mark-read");
    expect(matchShortcut(key("Escape", { shiftKey: true }), false)).toBeNull();
    expect(matchShortcut(key("a"), false)).toBeNull();
  });
});

describe("shouldRunShortcut", () => {
  const input = { tagName: "INPUT" } as unknown as EventTarget;
  const div = { tagName: "DIV" } as unknown as EventTarget;
  it("runs only the quick switcher and Escape in a text field", () => {
    expect(shouldRunShortcut("quick-switcher", input)).toBe(true);
    expect(shouldRunShortcut("mark-read", input)).toBe(true);
    expect(shouldRunShortcut("next-channel", input)).toBe(false);
    expect(shouldRunShortcut("toggle-mute", input)).toBe(false);
    expect(shouldRunShortcut("toggle-mute", div)).toBe(true);
  });
});

describe("adjacentId", () => {
  const ids = ["a", "b", "c", "d"];
  it("moves in both directions and wraps", () => {
    expect(adjacentId(ids, "b", 1)).toBe("c");
    expect(adjacentId(ids, "b", -1)).toBe("a");
    expect(adjacentId(ids, "d", 1)).toBe("a");
    expect(adjacentId(ids, "a", -1)).toBe("d");
  });
  it("starts at an end when no channel is open", () => {
    expect(adjacentId(ids, null, 1)).toBe("a");
    expect(adjacentId(ids, null, -1)).toBe("d");
    expect(adjacentId(ids, "x", 1)).toBe("a");
  });
  it("skips ids that are not accepted", () => {
    const unread = new Set(["a", "d"]);
    expect(adjacentId(ids, "b", 1, (id) => unread.has(id))).toBe("d");
    expect(adjacentId(ids, "b", -1, (id) => unread.has(id))).toBe("a");
    expect(adjacentId(ids, "a", 1, (id) => unread.has(id))).toBe("d");
    expect(adjacentId(ids, "b", 1, () => false)).toBeNull();
    expect(adjacentId([], null, 1)).toBeNull();
  });
});

describe("orderedTextChannelIds", () => {
  it("lists the top level channels first, then each category", () => {
    const channels = {
      cat1: { type: "category", parentId: null },
      t1: { type: "text", parentId: "cat1" },
      t2: { type: "text", parentId: null },
      v1: { type: "voice", parentId: null },
      t3: { type: "text", parentId: "cat1" },
    };
    expect(orderedTextChannelIds(["cat1", "t1", "t2", "v1", "t3"], channels)).toEqual(["t2", "t1", "t3"]);
  });
});

describe("fuzzy match", () => {
  it("needs the letters in order", () => {
    expect(fuzzyScore("gnl", "general")).not.toBeNull();
    expect(fuzzyScore("lng", "general")).toBeNull();
    expect(fuzzyScore("", "anything")).toBe(0);
  });
  it("ranks a prefix and a run higher", () => {
    expect(fuzzyScore("gen", "general")!).toBeGreaterThan(fuzzyScore("gen", "a big end here")!);
    expect(fuzzyScore("ran", "random")!).toBeGreaterThan(fuzzyScore("ran", "rx-a-n")!);
  });
  it("filters, sorts and limits", () => {
    const items = ["random", "general", "gaming", "voice"];
    expect(fuzzyFilter("ge", items, (x) => x, 10)).toEqual(["general"]);
    expect(fuzzyFilter("", items, (x) => x, 2)).toEqual(["random", "general"]);
    expect(fuzzyFilter("g", items, (x) => x, 10)[0]).not.toBe("random");
  });
});
