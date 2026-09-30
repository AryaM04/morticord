// Make a new .env file from .env.example, with random secrets.
// Usage: node scripts/generate-secrets.mjs [--force]
// The script stops when a .env file already exists, unless you use --force.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const example = new URL(".env.example", root);
const target = new URL(".env", root);

if (existsSync(target) && !process.argv.includes("--force")) {
  console.error("The .env file already exists. Use --force to replace it.");
  process.exit(1);
}

// Hex text is safe inside a database URL and a command line.
const secretNames = ["JWT_SECRET", "TURN_SECRET", "POSTGRES_PASSWORD"];
let text = readFileSync(example, "utf8");
for (const name of secretNames) {
  const secret = randomBytes(32).toString("hex");
  text = text.replace(new RegExp(`^${name}=.*$`, "m"), `${name}=${secret}`);
}
writeFileSync(target, text, { mode: 0o600 });
console.log(`The .env file is ready. It has new values for ${secretNames.join(", ")}.`);
console.log("Next, set DOMAIN, ACME_EMAIL, TURN_EXTERNAL_IP and the SMTP values in the .env file.");
