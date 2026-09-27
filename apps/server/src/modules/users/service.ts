// Users logic and database access. Routes stay thin and call these functions.
import { eq } from "drizzle-orm";
import type { AppConfig } from "../../config.js";
import type { DbClient } from "../../db/client.js";
import { users } from "../../db/schema.js";
import { AppError } from "../../errors.js";
import { deleteAvatarFile, generateAvatarKey, saveAvatarFile } from "./avatar.js";
import { type UserRow } from "./serialize.js";

export interface UsersDeps {
  db: DbClient;
  config: AppConfig;
}

export async function getUserOrThrow(db: DbClient, userId: bigint): Promise<UserRow> {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!rows[0]) {
    throw new AppError(404, "NOT_FOUND", "This user does not exist.");
  }
  return rows[0];
}

export interface UpdateMeInput {
  displayName?: string;
  statusText?: string | null;
}

export async function updateMe(deps: UsersDeps, userId: bigint, input: UpdateMeInput): Promise<UserRow> {
  const patch: Partial<{ displayName: string; statusText: string | null }> = {};
  if (input.displayName !== undefined) {
    patch.displayName = input.displayName;
  }
  if (input.statusText !== undefined) {
    patch.statusText = input.statusText === "" ? null : input.statusText;
  }

  if (Object.keys(patch).length > 0) {
    await deps.db.update(users).set(patch).where(eq(users.id, userId));
  }

  return getUserOrThrow(deps.db, userId);
}

export async function setAvatar(deps: UsersDeps, userId: bigint, buffer: Buffer): Promise<UserRow> {
  await saveAvatarFile(deps.config.dataDir, userId, buffer);
  const avatarKey = generateAvatarKey();
  await deps.db.update(users).set({ avatarKey }).where(eq(users.id, userId));
  return getUserOrThrow(deps.db, userId);
}

export async function removeAvatar(deps: UsersDeps, userId: bigint): Promise<UserRow> {
  await deleteAvatarFile(deps.config.dataDir, userId);
  await deps.db.update(users).set({ avatarKey: null }).where(eq(users.id, userId));
  return getUserOrThrow(deps.db, userId);
}
