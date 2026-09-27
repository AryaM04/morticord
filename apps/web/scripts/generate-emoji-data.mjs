// Build a compact emoji dataset from `unicode-emoji-json`, for the
// lazy-loaded emoji picker. Run this again only when the source package
// updates. Output: `src/emoji/emoji-data.json`, an array of records with
// short keys (`e` emoji, `n` name, `c` category) to keep the file small.
import { writeFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import data from "unicode-emoji-json/data-by-emoji.json" with { type: "json" };

const outPath = fileURLToPath(new URL("../src/emoji/emoji-data.json", import.meta.url));

const list = Object.entries(data).map(([emoji, info]) => ({
  e: emoji,
  n: info.name,
  c: info.group,
}));

writeFileSync(outPath, JSON.stringify(list));
console.log(`Wrote ${list.length} emoji records to ${outPath}.`);
