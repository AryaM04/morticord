// Who can see the device keys of whom. A user can see a different user
// when the two share a guild, share a DM or group DM, or are friends. The
// relation is symmetric. The same rule controls /keys/query, /keys/claim,
// /to-device and the DEVICE_LIST_UPDATE fan-out.
// See docs/concepts/olm-megolm.md section 4.
import { and, eq, inArray, ne, type Column, type SQL } from "drizzle-orm";
import { alias, union } from "drizzle-orm/pg-core";
import type { DbClient } from "../../db/client.js";
import { channelRecipients, friendships, guildMembers } from "../../db/schema.js";

function sharedUsersQuery(db: DbClient, userId: bigint, onlyIds?: bigint[]) {
  const otherMember = alias(guildMembers, "other_member");
  const otherRecipient = alias(channelRecipients, "other_recipient");
  const filter = (column: Column): SQL =>
    onlyIds ? inArray(column, onlyIds) : ne(column, userId);

  const guildPeers = db
    .select({ userId: otherMember.userId })
    .from(guildMembers)
    .innerJoin(otherMember, eq(otherMember.guildId, guildMembers.guildId))
    .where(and(eq(guildMembers.userId, userId), filter(otherMember.userId)));
  const dmPeers = db
    .select({ userId: otherRecipient.userId })
    .from(channelRecipients)
    .innerJoin(otherRecipient, eq(otherRecipient.channelId, channelRecipients.channelId))
    .where(and(eq(channelRecipients.userId, userId), filter(otherRecipient.userId)));
  const friends = db
    .select({ userId: friendships.otherId })
    .from(friendships)
    .where(and(eq(friendships.userId, userId), eq(friendships.status, "accepted"), filter(friendships.otherId)));
  return union(guildPeers, dmPeers, friends);
}

/** The subset of `userIds` that `callerId` can see. The caller always sees itself. */
export async function visibleUserIds(db: DbClient, callerId: bigint, userIds: bigint[]): Promise<Set<bigint>> {
  const visible = new Set<bigint>();
  if (userIds.includes(callerId)) {
    visible.add(callerId);
  }
  const others = userIds.filter((id) => id !== callerId);
  if (others.length > 0) {
    for (const row of await sharedUsersQuery(db, callerId, others)) {
      visible.add(row.userId);
    }
  }
  return visible;
}

/** Every user who can see `userId`, and `userId` itself (for its own other devices). */
export async function usersWhoCanSee(db: DbClient, userId: bigint): Promise<bigint[]> {
  const rows = await sharedUsersQuery(db, userId);
  return [userId, ...rows.map((row) => row.userId)];
}
