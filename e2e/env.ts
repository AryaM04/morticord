// Read values from the root .env file, for the e2e test process.
//
// The e2e package has no server and no build step, so it cannot read the
// shared config through the server. It reads the same .env file by
// itself, with a small, plain parser (no extra dependency).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = join(here, "..", ".env");

/**
 * Load KEY=VALUE lines from the root .env file into process.env.
 * It never overwrites a value already set in the environment, so a
 * value set on the command line still wins. It does nothing, and does
 * not throw, when the file is missing.
 */
export function loadRootEnv(): void {
  let text: string;
  try {
    text = readFileSync(rootEnvPath, "utf8");
  } catch {
    return;
  }

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
