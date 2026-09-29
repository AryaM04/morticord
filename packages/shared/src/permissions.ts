// Permission bitflags and the permission calculator.
// Each flag is one bit in a bigint. The server and the client both use this
// file, so a permission check gives the same result in both places.

export const Permission = {
  VIEW_CHANNEL: 1n << 0n,
  SEND_MESSAGES: 1n << 1n,
  READ_MESSAGE_HISTORY: 1n << 2n,
  ATTACH_FILES: 1n << 3n,
  ADD_REACTIONS: 1n << 4n,
  MENTION_EVERYONE: 1n << 5n,
  MANAGE_MESSAGES: 1n << 6n,
  MANAGE_CHANNELS: 1n << 7n,
  MANAGE_ROLES: 1n << 8n,
  MANAGE_GUILD: 1n << 9n,
  CREATE_INVITE: 1n << 10n,
  KICK_MEMBERS: 1n << 11n,
  BAN_MEMBERS: 1n << 12n,
  CONNECT: 1n << 13n,
  SPEAK: 1n << 14n,
  VIDEO: 1n << 15n,
  STREAM: 1n << 16n,
  MUTE_MEMBERS: 1n << 17n,
  DEAFEN_MEMBERS: 1n << 18n,
  MOVE_MEMBERS: 1n << 19n,
  ADMINISTRATOR: 1n << 20n,
  CHANGE_NICKNAME: 1n << 21n,
  MANAGE_NICKNAMES: 1n << 22n,
} as const;

export type PermissionName = keyof typeof Permission;

/** A bitmask that has every known permission flag set. */
export const ALL_PERMISSIONS: bigint = Object.values(Permission).reduce(
  (mask, flag) => mask | flag,
  0n,
);

/**
 * What every person in a DM or a group DM can do. There are no roles or
 * overwrites in a DM, and nobody has a MANAGE_* permission. Each person can
 * delete only their own events.
 */
export const DM_PERMISSIONS: bigint =
  Permission.VIEW_CHANNEL |
  Permission.SEND_MESSAGES |
  Permission.READ_MESSAGE_HISTORY |
  Permission.ADD_REACTIONS |
  Permission.ATTACH_FILES |
  Permission.CONNECT |
  Permission.SPEAK |
  Permission.VIDEO |
  Permission.STREAM;

export function hasPermission(mask: bigint, flag: bigint): boolean {
  return (mask & flag) === flag;
}

export interface RoleInput {
  id: bigint;
  permissions: bigint;
}

export interface OverwriteInput {
  targetId: bigint;
  targetType: "role" | "member";
  allow: bigint;
  deny: bigint;
}

export interface ComputePermissionsInput {
  /** True when the member is the guild owner. The owner always has every permission. */
  isOwner: boolean;
  /** The @everyone role. Its permissions apply to every member. */
  everyoneRole: RoleInput;
  /** The other roles held by the member, not counting @everyone. */
  memberRoles: RoleInput[];
  /** All overwrites on the channel, for any role or member. */
  overwrites: OverwriteInput[];
  /** The member's user ID, used to find a member-level overwrite. */
  memberId: bigint;
}

/**
 * Compute the effective permission bitmask for one member in one channel.
 * The steps are, in order:
 *   1. The owner gets every permission, with no further checks.
 *   2. The base mask is @everyone permissions combined with all role permissions.
 *   3. ADMINISTRATOR in the base mask grants every permission, with no further checks.
 *   4. Apply the @everyone overwrite: deny bits first, then allow bits.
 *   5. Apply the combined deny bits of all matching role overwrites, then the combined allow bits.
 *   6. Apply the member overwrite, if one exists: deny bits first, then allow bits.
 */
export function computePermissions(input: ComputePermissionsInput): bigint {
  if (input.isOwner) {
    return ALL_PERMISSIONS;
  }

  let base = input.everyoneRole.permissions;
  for (const role of input.memberRoles) {
    base |= role.permissions;
  }

  if (hasPermission(base, Permission.ADMINISTRATOR)) {
    return ALL_PERMISSIONS;
  }

  let permissions = base;

  const everyoneOverwrite = input.overwrites.find(
    (overwrite) =>
      overwrite.targetType === "role" && overwrite.targetId === input.everyoneRole.id,
  );
  if (everyoneOverwrite) {
    permissions &= ~everyoneOverwrite.deny;
    permissions |= everyoneOverwrite.allow;
  }

  const roleIds = new Set(input.memberRoles.map((role) => role.id));
  let roleDeny = 0n;
  let roleAllow = 0n;
  for (const overwrite of input.overwrites) {
    if (overwrite.targetType === "role" && roleIds.has(overwrite.targetId)) {
      roleDeny |= overwrite.deny;
      roleAllow |= overwrite.allow;
    }
  }
  permissions &= ~roleDeny;
  permissions |= roleAllow;

  const memberOverwrite = input.overwrites.find(
    (overwrite) => overwrite.targetType === "member" && overwrite.targetId === input.memberId,
  );
  if (memberOverwrite) {
    permissions &= ~memberOverwrite.deny;
    permissions |= memberOverwrite.allow;
  }

  // A member that cannot see the channel has no permissions in it.
  // The E2EE code uses this result to decide who gets channel keys.
  if (!hasPermission(permissions, Permission.VIEW_CHANNEL)) {
    return 0n;
  }

  return permissions;
}
