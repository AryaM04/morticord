// Guild logic and database access. Routes stay thin and call these functions.
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { hasPermission, Permission } from "@discord-clone/shared";
import { DispatchEvent } from "@discord-clone/shared";
import type { AppConfig } from "../../config.js";
import type { DbClient } from "../../db/client.js";
import { channels, guildMembers, guilds, roles } from "../../db/schema.js";
import { AppError } from "../../errors.js";
import { nextId } from "../../id.js";
import type { GatewayService } from "../gateway/service.js";
import { deleteIconFile, generateIconKey, saveIconFile } from "./icon.js";
import {
  guildPermissions,
  loadMemberContext,
  loadViewableChannels,
  type ChannelRow,
  type MemberContext,
} from "./member-context.js";
import { toGuildView, type MemberRow } from "./serialize.js";

export const MAX_OWNED_GUILDS = 100;
export const MAX_JOINED_GUILDS = 200;

// The @everyone role a new guild gets, in one bitmask.
const DEFAULT_EVERYONE_PERMISSIONS =
  Permission.VIEW_CHANNEL |
  Permission.SEND_MESSAGES |
  Permission.READ_MESSAGE_HISTORY |
  Permission.ADD_REACTIONS |
  Permission.ATTACH_FILES |
  Permission.CREATE_INVITE |
  Permission.CONNECT |
  Permission.SPEAK |
  Permission.VIDEO |
  Permission.STREAM;

export interface GuildsDeps {
  db: DbClient;
  config: AppConfig;
  gateway?: GatewayService;
}

async function loadOwnMemberRow(db: DbClient, guildId: bigint, userId: bigint): Promise<MemberRow> {
  const rows = await db
    .select()
    .from(guildMembers)
    .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new AppError(500, "INTERNAL_ERROR", "The member row was not found right after it was made.");
  }
  return row;
}

/** Build the full guild view (guild, roles, viewable channels, own member) for one caller. */
export async function buildGuildView(db: DbClient, guildId: bigint, userId: bigint) {
  const context = await loadMemberContext(db, guildId, userId);
  if (!context) {
    throw new AppError(404, "NOT_FOUND", "This guild does not exist.");
  }
  const viewableChannels = await loadViewableChannels(db, context);
  const member = await loadOwnMemberRow(db, guildId, userId);
  return toGuildView(context.guild, context.allRoles, viewableChannels, member, [
    ...context.memberRoles.map((role) => role.id),
  ]);
}

export async function createGuild(deps: GuildsDeps, userId: bigint, name: string) {
  const { db, gateway } = deps;

  const ownedCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(guilds)
    .where(eq(guilds.ownerId, userId));
  if ((ownedCount[0]?.count ?? 0) >= MAX_OWNED_GUILDS) {
    throw new AppError(403, "OWNED_GUILD_LIMIT", `You cannot own more than ${MAX_OWNED_GUILDS} guilds.`);
  }
  const joinedCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(guildMembers)
    .where(eq(guildMembers.userId, userId));
  if ((joinedCount[0]?.count ?? 0) >= MAX_JOINED_GUILDS) {
    throw new AppError(403, "JOINED_GUILD_LIMIT", `You cannot be in more than ${MAX_JOINED_GUILDS} guilds.`);
  }

  const guildId = nextId();

  await db.transaction(async (tx) => {
    await tx.insert(guilds).values({ id: guildId, name, ownerId: userId });

    await tx.insert(roles).values({
      id: guildId,
      guildId,
      name: "@everyone",
      color: 0,
      position: 0,
      permissions: DEFAULT_EVERYONE_PERMISSIONS,
      mentionable: true,
    });

    await tx.insert(guildMembers).values({ guildId, userId, nickname: null });

    const textCategoryId = nextId();
    const voiceCategoryId = nextId();
    await tx.insert(channels).values([
      { id: textCategoryId, guildId, type: "category", name: "Text channels", position: 0 },
      { id: nextId(), guildId, type: "text", name: "general", position: 0, parentId: textCategoryId },
      { id: voiceCategoryId, guildId, type: "category", name: "Voice channels", position: 1 },
      { id: nextId(), guildId, type: "voice", name: "General", position: 0, parentId: voiceCategoryId },
    ]);
  });

  gateway?.addUserToGuild(guildId, userId);
  const view = await buildGuildView(db, guildId, userId);
  gateway?.toUser(userId, DispatchEvent.GUILD_CREATE, view);
  return view;
}

export async function getGuildView(db: DbClient, guildId: bigint, userId: bigint) {
  return buildGuildView(db, guildId, userId);
}

export async function updateGuild(
  deps: GuildsDeps,
  guildId: bigint,
  userId: bigint,
  patch: { name?: string },
) {
  const { db, gateway } = deps;
  const context = await loadMemberContext(db, guildId, userId);
  if (!context) {
    throw new AppError(404, "NOT_FOUND", "This guild does not exist.");
  }
  requirePermission(context, Permission.MANAGE_GUILD);

  if (patch.name !== undefined) {
    await db.update(guilds).set({ name: patch.name }).where(eq(guilds.id, guildId));
  }
  const view = await buildGuildView(db, guildId, userId);
  gateway?.toGuild(guildId, DispatchEvent.GUILD_UPDATE, {
    id: view.id,
    name: view.name,
    iconKey: view.iconKey,
    ownerId: view.ownerId,
    createdAt: view.createdAt,
  });
  return view;
}

export async function deleteGuild(deps: GuildsDeps, guildId: bigint, userId: bigint): Promise<void> {
  const { db, config, gateway } = deps;
  const context = await loadMemberContext(db, guildId, userId);
  if (!context) {
    throw new AppError(404, "NOT_FOUND", "This guild does not exist.");
  }
  if (!context.isOwner) {
    throw new AppError(403, "OWNER_ONLY", "Only the guild owner can delete the guild.");
  }

  const memberRows = await db
    .select({ userId: guildMembers.userId })
    .from(guildMembers)
    .where(eq(guildMembers.guildId, guildId));

  await db.delete(guilds).where(eq(guilds.id, guildId));
  if (context.guild.iconKey) {
    await deleteIconFile(config.dataDir, guildId);
  }

  if (gateway) {
    gateway.toUsers(memberRows.map((row) => row.userId), DispatchEvent.GUILD_DELETE, { id: guildId.toString() });
    gateway.removeGuild(guildId);
  }
}

export async function setGuildIcon(deps: GuildsDeps, guildId: bigint, userId: bigint, buffer: Buffer) {
  const { db, config } = deps;
  const context = await loadMemberContext(db, guildId, userId);
  if (!context) {
    throw new AppError(404, "NOT_FOUND", "This guild does not exist.");
  }
  requirePermission(context, Permission.MANAGE_GUILD);

  await saveIconFile(config.dataDir, guildId, buffer);
  const iconKey = generateIconKey();
  await db.update(guilds).set({ iconKey }).where(eq(guilds.id, guildId));
  return buildGuildView(db, guildId, userId);
}

export async function removeGuildIcon(deps: GuildsDeps, guildId: bigint, userId: bigint) {
  const { db, config } = deps;
  const context = await loadMemberContext(db, guildId, userId);
  if (!context) {
    throw new AppError(404, "NOT_FOUND", "This guild does not exist.");
  }
  requirePermission(context, Permission.MANAGE_GUILD);

  await deleteIconFile(config.dataDir, guildId);
  await db.update(guilds).set({ iconKey: null }).where(eq(guilds.id, guildId));
  return buildGuildView(db, guildId, userId);
}

export async function leaveGuild(deps: GuildsDeps, guildId: bigint, userId: bigint): Promise<void> {
  const { db, gateway } = deps;
  const context = await loadMemberContext(db, guildId, userId);
  if (!context) {
    throw new AppError(404, "NOT_FOUND", "This guild does not exist.");
  }
  if (context.isOwner) {
    throw new AppError(409, "OWNER_CANNOT_LEAVE", "The guild owner cannot leave. Delete the guild instead.");
  }
  await db.delete(guildMembers).where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId)));

  gateway?.toGuild(guildId, DispatchEvent.GUILD_MEMBER_REMOVE, { guildId: guildId.toString(), userId: userId.toString() });
  gateway?.toUser(userId, DispatchEvent.GUILD_DELETE, { id: guildId.toString() });
  gateway?.removeUserFromGuild(guildId, userId);
}

export interface ListMembersInput {
  after?: bigint;
  limit: number;
}

export async function listMembers(db: DbClient, guildId: bigint, userId: bigint, input: ListMembersInput) {
  const context = await loadMemberContext(db, guildId, userId);
  if (!context) {
    throw new AppError(404, "NOT_FOUND", "This guild does not exist.");
  }

  const conditions = [eq(guildMembers.guildId, guildId)];
  if (input.after !== undefined) {
    conditions.push(gt(guildMembers.userId, input.after));
  }

  const rows = await db
    .select()
    .from(guildMembers)
    .where(and(...conditions))
    .orderBy(asc(guildMembers.userId))
    .limit(input.limit);

  return rows;
}

/** Throw 403 when the caller lacks the given guild-level permission. Call after a membership check. */
export function requirePermission(context: MemberContext, permission: bigint): void {
  if (!hasPermission(guildPermissions(context), permission)) {
    throw new AppError(403, "MISSING_PERMISSION", "You do not have permission to do this.");
  }
}

export type { ChannelRow };
