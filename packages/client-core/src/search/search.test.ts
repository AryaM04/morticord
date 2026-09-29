// Tests for the local search: word folding (case and diacritics), the
// query filters, the snippet, and the IndexedDB index (search, update on
// edit and redaction, the size bound, and no plain words at rest).
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { hasLink, openLocalSearchIndex, type IndexInput, type IndexKeys } from "./local-index.js";
import { foldText, isEmptyQuery, makeSnippet, parseSearchQuery, tokenize } from "./text.js";

async function testKeys(): Promise<IndexKeys> {
  return {
    encryptionKey: await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]),
    tokenKey: await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
  };
}

function message(id: string, body: string, extra: Partial<IndexInput> = {}): IndexInput {
  return { id, channelId: "c1", senderId: "u1", createdAt: "2026-09-29T10:00:00.000Z", body, hasFile: false, ...extra };
}

describe("tokenize and foldText", () => {
  it("folds case and diacritics", () => {
    expect(foldText("Élan CAFÉ Straße")).toBe("elan cafe straße");
    expect(tokenize("Crème Brûlée, crème brulee!")).toEqual(["creme", "brulee"]);
  });

  it("splits on everything that is not a letter or a digit, and keeps other scripts", () => {
    expect(tokenize("see https://example.com/a-b_c 42x")).toEqual(["see", "https", "example", "com", "a", "b", "c", "42x"]);
    expect(tokenize("Привет мир")).toEqual(["привет", "мир"]);
  });
});

describe("parseSearchQuery", () => {
  it("reads the filters and folds the words", () => {
    expect(parseSearchQuery("Héllo from:@Ana in:#General has:link has:file world")).toEqual({
      terms: ["hello", "world"],
      from: ["ana"],
      in: ["general"],
      has: ["link", "file"],
    });
  });

  it("keeps an unknown filter as plain words", () => {
    expect(parseSearchQuery("has:cake").terms).toEqual(["has", "cake"]);
    expect(isEmptyQuery(parseSearchQuery("   "))).toBe(true);
    expect(isEmptyQuery(parseSearchQuery("from:@ana"))).toBe(false);
  });
});

describe("makeSnippet", () => {
  it("shows a short body in full, and a part around the first match of a long one", () => {
    expect(makeSnippet("short  text", ["text"])).toBe("short text");
    const long = `${"a ".repeat(200)}needle ${"b ".repeat(200)}`;
    const snippet = makeSnippet(long, ["needle"], 60);
    expect(snippet).toContain("needle");
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
  });
});

describe("openLocalSearchIndex", () => {
  async function openIndex(maxMessages?: number) {
    const indexedDb = new IDBFactory();
    const index = await openLocalSearchIndex({ name: "search:u1:d1", keys: await testKeys(), indexedDb, maxMessages });
    return { index, indexedDb };
  }

  it("finds messages by folded words, newest first, with every term required", async () => {
    const { index } = await openIndex();
    await index.add([message("10", "The Café is open"), message("11", "cafe closed"), message("12", "nothing here")]);
    expect((await index.search({ terms: ["cafe"], has: [] })).map((r) => r.id)).toEqual(["11", "10"]);
    expect((await index.search({ terms: ["cafe", "open"], has: [] })).map((r) => r.id)).toEqual(["10"]);
    const [result] = await index.search({ terms: ["open"], has: [] });
    expect(result).toMatchObject({ id: "10", channelId: "c1", senderId: "u1", body: "The Café is open" });
  });

  it("applies the from, in and has filters", async () => {
    const { index } = await openIndex();
    await index.add([
      message("1", "hello there", { senderId: "ana", channelId: "general" }),
      message("2", "hello https://example.com", { senderId: "bob", channelId: "general" }),
      message("3", "hello with a file", { senderId: "ana", channelId: "random", hasFile: true }),
    ]);
    const ids = async (query: Parameters<typeof index.search>[0]) => (await index.search(query)).map((r) => r.id);
    expect(await ids({ terms: ["hello"], has: [], senderIds: ["ana"] })).toEqual(["3", "1"]);
    expect(await ids({ terms: ["hello"], has: [], channelIds: ["general"] })).toEqual(["2", "1"]);
    expect(await ids({ terms: [], has: ["link"] })).toEqual(["2"]);
    expect(await ids({ terms: [], has: ["file"] })).toEqual(["3"]);
    expect(await ids({ terms: [], has: [], senderIds: ["ana"], channelIds: ["general"] })).toEqual(["1"]);
    expect(hasLink("see http://x.test")).toBe(true);
  });

  it("updates on an edit from the sender only, keeps the newest edit, and removes on redaction", async () => {
    const { index } = await openIndex();
    await index.add([message("20", "first text")]);
    await index.applyEdits([{ targetId: "20", editId: "22", senderId: "u1", body: "second text" }]);
    await index.applyEdits([{ targetId: "20", editId: "21", senderId: "u1", body: "older edit" }]);
    await index.applyEdits([{ targetId: "20", editId: "23", senderId: "intruder", body: "forged" }]);
    expect(await index.search({ terms: ["first"], has: [] })).toEqual([]);
    expect(await index.search({ terms: ["older"], has: [] })).toEqual([]);
    expect(await index.search({ terms: ["forged"], has: [] })).toEqual([]);
    expect((await index.search({ terms: ["second"], has: [] }))[0]?.body).toBe("second text");
    // The same message fetched again does not undo the edit.
    await index.add([message("20", "first text")]);
    expect((await index.search({ terms: ["text"], has: [] }))[0]?.body).toBe("second text");

    await index.remove(["20"]);
    expect(await index.search({ terms: ["text"], has: [] })).toEqual([]);
    expect(await index.count()).toBe(0);
  });

  it("keeps at most the limit, and drops the oldest messages first", async () => {
    const { index } = await openIndex(5);
    await index.add(Array.from({ length: 8 }, (_, i) => message(String(100 + i), `word ${i}`)));
    expect(await index.count()).toBe(5);
    expect((await index.search({ terms: ["word"], has: [] })).map((r) => r.id)).toEqual(["107", "106", "105", "104", "103"]);
  });

  it("stores no plain word and no plain text", async () => {
    const { index, indexedDb } = await openIndex();
    await index.add([message("30", "supersecretword")]);
    index.close();
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDb.open("search:u1:d1");
      request.onsuccess = () => resolve(request.result);
    });
    const records = await new Promise<unknown[]>((resolve) => {
      const request = db.transaction("messages").objectStore("messages").getAll();
      request.onsuccess = () => resolve(request.result);
    });
    const text = JSON.stringify(records, (_key, value) =>
      value instanceof ArrayBuffer ? new TextDecoder().decode(value) : (value as unknown),
    );
    expect(text).not.toContain("supersecret");
    db.close();
  });
});
