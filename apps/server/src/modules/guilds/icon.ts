// Guild icon file storage on disk. Same rules as the user avatar: one file
// per guild, written atomically, named by a random cache-busting key.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

function iconDir(dataDir: string): string {
  return path.join(dataDir, "icons");
}

function iconFilePath(dataDir: string, guildId: bigint): string {
  return path.join(iconDir(dataDir), guildId.toString());
}

/** Write the icon file atomically: a temp file, then one rename. */
export async function saveIconFile(dataDir: string, guildId: bigint, buffer: Buffer): Promise<void> {
  const dir = iconDir(dataDir);
  await mkdir(dir, { recursive: true });
  const finalPath = iconFilePath(dataDir, guildId);
  const tempPath = `${finalPath}.tmp-${randomBytes(6).toString("hex")}`;
  await writeFile(tempPath, buffer);
  await rename(tempPath, finalPath);
}

/** Read the icon file. Returns null when the guild has no icon file. */
export async function readIconFile(dataDir: string, guildId: bigint): Promise<Buffer | null> {
  try {
    return await readFile(iconFilePath(dataDir, guildId));
  } catch {
    return null;
  }
}

/** Remove the icon file. Does nothing when there is no file. */
export async function deleteIconFile(dataDir: string, guildId: bigint): Promise<void> {
  try {
    await unlink(iconFilePath(dataDir, guildId));
  } catch {
    // No file to remove is not an error here.
  }
}

/** Make a new, random icon version key, used for cache-busting URLs. */
export function generateIconKey(): string {
  return randomBytes(8).toString("base64url");
}
