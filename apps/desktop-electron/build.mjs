// Build the Electron app code with esbuild: the main process, the two
// preload scripts and the screen picker page. The output goes to dist/.
// The web build is separate (apps/web/dist); electron-builder copies it.
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { build } from "esbuild";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/desktop", { recursive: true });

const common = { bundle: true, minify: true, legalComments: "none", logLevel: "warning", target: "node22" };

await Promise.all([
  // The main process. uiohook-napi is a native module, so it stays in node_modules.
  build({
    ...common,
    entryPoints: ["src/main/index.ts"],
    outfile: "dist/main.cjs",
    platform: "node",
    format: "cjs",
    external: ["electron", "uiohook-napi"],
  }),
  // Preload scripts run in the sandbox: one file each, and only require("electron").
  build({
    ...common,
    entryPoints: ["src/preload/index.ts"],
    outfile: "dist/preload.cjs",
    platform: "node",
    format: "iife",
    external: ["electron"],
  }),
  build({
    ...common,
    entryPoints: ["src/picker/preload.ts"],
    outfile: "dist/picker-preload.cjs",
    platform: "node",
    format: "iife",
    external: ["electron"],
  }),
  build({
    ...common,
    entryPoints: ["src/picker/picker.ts"],
    outfile: "dist/desktop/picker.js",
    platform: "browser",
    format: "iife",
    target: "chrome130",
  }),
]);

copyFileSync("src/picker/picker.html", "dist/desktop/picker.html");
copyFileSync("src/picker/picker.css", "dist/desktop/picker.css");
