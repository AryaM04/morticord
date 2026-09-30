// A small JSON file in the user data folder. A write goes to a temporary
// file first and then replaces the old file, so a crash never leaves half
// a file. Writes run one after the other.
import { readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";

export class JsonFile<T extends object> {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly mode = 0o600,
  ) {}

  /** Read the file. Returns null when it does not exist or is not valid JSON. */
  read(): Partial<T> | null {
    try {
      const value: unknown = JSON.parse(readFileSync(this.path, "utf8"));
      return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Partial<T>) : null;
    } catch {
      return null;
    }
  }

  /** Replace the file with this value. */
  write(value: T): Promise<void> {
    const next = this.queue.then(async () => {
      const temporary = `${this.path}.tmp`;
      await writeFile(temporary, JSON.stringify(value), { mode: this.mode });
      await rename(temporary, this.path);
    });
    // A failed write does not stop the next write.
    this.queue = next.catch(() => {});
    return next;
  }
}
