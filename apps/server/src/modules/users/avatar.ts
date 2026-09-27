// Avatar file storage on disk, plus the magic-byte check for uploads.
// A user gets one avatar file, named by their user id, written atomically
// (write to a temp file, then rename) so a partial write never gets served.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export type ImageContentType = "image/png" | "image/jpeg" | "image/webp";

/** Look at the first bytes of a file to find its real image type. Ignores the header. */
export function detectImageContentType(buffer: Buffer): ImageContentType | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

function avatarDir(dataDir: string): string {
  return path.join(dataDir, "avatars");
}

function avatarFilePath(dataDir: string, userId: bigint): string {
  return path.join(avatarDir(dataDir), userId.toString());
}

/** Write the avatar file atomically: a temp file, then one rename. */
export async function saveAvatarFile(dataDir: string, userId: bigint, buffer: Buffer): Promise<void> {
  const dir = avatarDir(dataDir);
  await mkdir(dir, { recursive: true });
  const finalPath = avatarFilePath(dataDir, userId);
  const tempPath = `${finalPath}.tmp-${randomBytes(6).toString("hex")}`;
  await writeFile(tempPath, buffer);
  await rename(tempPath, finalPath);
}

/** Read the avatar file. Returns null when the user has no avatar file. */
export async function readAvatarFile(dataDir: string, userId: bigint): Promise<Buffer | null> {
  try {
    return await readFile(avatarFilePath(dataDir, userId));
  } catch {
    return null;
  }
}

/** Remove the avatar file. Does nothing when there is no file. */
export async function deleteAvatarFile(dataDir: string, userId: bigint): Promise<void> {
  try {
    await unlink(avatarFilePath(dataDir, userId));
  } catch {
    // No file to remove is not an error here.
  }
}

/** Make a new, random avatar version key, used for cache-busting URLs. */
export function generateAvatarKey(): string {
  return randomBytes(8).toString("base64url");
}
