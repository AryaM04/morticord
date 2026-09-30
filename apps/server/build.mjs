// Bundle the server into one file for the production image.
// The workspace packages (shared, link-preview-fetch) ship TypeScript
// source, so the bundle includes them. All other dependencies stay
// outside the bundle and load from node_modules.
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const manifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const external = Object.entries(manifest.dependencies)
  .filter(([, version]) => !String(version).startsWith("workspace:"))
  .map(([name]) => name);

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  external,
});
