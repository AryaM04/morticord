// Request and response schemas for guilds, channels, members and invites.
import { z } from "zod";
import { idSchema } from "./common.js";
import { displayNameSchema, userSchema } from "./auth.js";
import { voiceStateSchema } from "./voice.js";

export const guildNameSchema = z
  .string()
  .trim()
  .min(1, "The guild name must have at least 1 character.")
  .max(100, "The guild name must have at most 100 characters.");

export const createGuildRequestSchema = z.object({
  name: guildNameSchema,
});
export type CreateGuildRequest = z.infer<typeof createGuildRequestSchema>;

export const updateGuildRequestSchema = z.object({
  name: guildNameSchema.optional(),
});
export type UpdateGuildRequest = z.infer<typeof updateGuildRequestSchema>;

export const roleSchema = z.object({
  id: idSchema,
  guildId: idSchema,
  name: z.string(),
  color: z.number().int(),
  position: z.number().int(),
  permissions: z.string(),
  mentionable: z.boolean(),
  /** True when the role's members show as a separate group in the member list. */
  hoist: z.boolean(),
});
export type RoleJson = z.infer<typeof roleSchema>;

export const roleNameSchema = z
  .string()
  .trim()
  .min(1, "The role name must have at least 1 character.")
  .max(100, "The role name must have at most 100 characters.");

/** A decimal-string bigint permission bitmask, as it goes on the wire. */
export const permissionMaskSchema = z.string().regex(/^[0-9]+$/, "The permission mask must be a decimal number.");

export const MAX_ROLES_PER_GUILD = 100;

export const createRoleRequestSchema = z.object({
  name: roleNameSchema.default("new role"),
  color: z.number().int().min(0).max(0xffffff).default(0),
  permissions: permissionMaskSchema.default("0"),
  mentionable: z.boolean().default(true),
  hoist: z.boolean().default(false),
});
export type CreateRoleRequest = z.infer<typeof createRoleRequestSchema>;

export const updateRoleRequestSchema = z.object({
  name: roleNameSchema.optional(),
  color: z.number().int().min(0).max(0xffffff).optional(),
  permissions: permissionMaskSchema.optional(),
  mentionable: z.boolean().optional(),
  hoist: z.boolean().optional(),
});
export type UpdateRoleRequest = z.infer<typeof updateRoleRequestSchema>;

export const roleOrderEntrySchema = z.object({
  id: idSchema,
  position: z.number().int().min(0),
});
export const roleOrderRequestSchema = z.array(roleOrderEntrySchema).min(1).max(MAX_ROLES_PER_GUILD);
export type RoleOrderRequest = z.infer<typeof roleOrderRequestSchema>;

export const channelTypeSchema = z.enum(["text", "voice", "category"]);
export type ChannelType = z.infer<typeof channelTypeSchema>;

export const channelNameSchema = z
  .string()
  .trim()
  .min(1, "The channel name must have at least 1 character.")
  .max(100, "The channel name must have at most 100 characters.");

export const channelTopicSchema = z
  .string()
  .trim()
  .max(1024, "The topic must have at most 1024 characters.");

export const overwriteTargetTypeSchema = z.enum(["role", "member"]);
export type OverwriteTargetType = z.infer<typeof overwriteTargetTypeSchema>;

/** One permission overwrite on a channel, for a role or a member. */
export const permissionOverwriteSchema = z.object({
  targetId: idSchema,
  targetType: overwriteTargetTypeSchema,
  allow: z.string(),
  deny: z.string(),
});
export type PermissionOverwriteJson = z.infer<typeof permissionOverwriteSchema>;

export const channelSchema = z.object({
  id: idSchema,
  guildId: idSchema,
  type: channelTypeSchema,
  name: z.string().nullable(),
  topic: z.string().nullable(),
  position: z.number().int(),
  parentId: idSchema.nullable(),
  /** Every overwrite on this channel, so a client can compute permissions locally. */
  permissionOverwrites: z.array(permissionOverwriteSchema),
  /** The newest timeline event (a message or a reply) in this channel, for cheap unread state. */
  lastEventId: idSchema.nullable(),
});
export type ChannelJson = z.infer<typeof channelSchema>;

export const createChannelRequestSchema = z.object({
  name: channelNameSchema,
  type: channelTypeSchema,
  parentId: idSchema.nullable().optional(),
  topic: channelTopicSchema.optional(),
});
export type CreateChannelRequest = z.infer<typeof createChannelRequestSchema>;

export const updateChannelRequestSchema = z.object({
  name: channelNameSchema.optional(),
  topic: channelTopicSchema.nullable().optional(),
  parentId: idSchema.nullable().optional(),
});
export type UpdateChannelRequest = z.infer<typeof updateChannelRequestSchema>;

export const channelOrderEntrySchema = z.object({
  id: idSchema,
  position: z.number().int().min(0),
  parentId: idSchema.nullable(),
});
export const channelOrderRequestSchema = z.array(channelOrderEntrySchema).min(1).max(500);
export type ChannelOrderRequest = z.infer<typeof channelOrderRequestSchema>;

export const guildMemberSchema = z.object({
  guildId: idSchema,
  userId: idSchema,
  nickname: z.string().nullable(),
  joinedAt: z.string(),
  roles: z.array(idSchema),
  user: userSchema.optional(),
});
export type GuildMemberJson = z.infer<typeof guildMemberSchema>;

export const guildSchema = z.object({
  id: idSchema,
  name: guildNameSchema,
  iconKey: z.string().nullable(),
  ownerId: idSchema,
  createdAt: z.string(),
});
export type GuildJson = z.infer<typeof guildSchema>;

/** The full guild view: the guild, its roles, the caller's visible channels and the caller's own member row. */
export const guildViewSchema = guildSchema.extend({
  roles: z.array(roleSchema),
  channels: z.array(channelSchema),
  /** The current voice state of every peer in a voice channel of this guild that the caller can view. */
  voiceStates: z.array(voiceStateSchema),
  member: guildMemberSchema,
});
export type GuildView = z.infer<typeof guildViewSchema>;

export const listMembersQuerySchema = z.object({
  after: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListMembersQuery = z.infer<typeof listMembersQuerySchema>;

export const searchMembersQuerySchema = z.object({
  q: z.string().trim().min(1).max(32),
  limit: z.coerce.number().int().min(1).max(10).default(10),
});
export type SearchMembersQuery = z.infer<typeof searchMembersQuerySchema>;

export const searchMembersResponseSchema = z.object({
  members: z.array(guildMemberSchema),
});
export type SearchMembersResponse = z.infer<typeof searchMembersResponseSchema>;

export const nicknameSchema = displayNameSchema;

export const updateMemberRequestSchema = z.object({
  nickname: nicknameSchema.nullable().optional(),
});
export type UpdateMemberRequest = z.infer<typeof updateMemberRequestSchema>;

export const putOverwriteRequestSchema = z.object({
  type: overwriteTargetTypeSchema,
  allow: permissionMaskSchema,
  deny: permissionMaskSchema,
});
export type PutOverwriteRequest = z.infer<typeof putOverwriteRequestSchema>;

export const banSchema = z.object({
  guildId: idSchema,
  userId: idSchema,
  reason: z.string().nullable(),
  by: idSchema,
});
export type BanJson = z.infer<typeof banSchema>;

export const MAX_DELETE_MESSAGE_SECONDS = 604800; // 7 days

export const createBanRequestSchema = z.object({
  reason: z.string().trim().max(512).optional(),
  deleteMessageSeconds: z.number().int().min(0).max(MAX_DELETE_MESSAGE_SECONDS).default(0),
});
export type CreateBanRequest = z.infer<typeof createBanRequestSchema>;

export const voiceModerationRequestSchema = z.object({
  mute: z.boolean().optional(),
  deaf: z.boolean().optional(),
  channelId: idSchema.nullable().optional(),
});
export type VoiceModerationRequest = z.infer<typeof voiceModerationRequestSchema>;

export const transferGuildRequestSchema = z.object({
  userId: idSchema,
});
export type TransferGuildRequest = z.infer<typeof transferGuildRequestSchema>;

// 0 means "no limit" for maxUses, and 0 means "never expires" for maxAgeSeconds.
export const INVITE_MAX_AGE_SECONDS = [0, 1800, 3600, 21600, 43200, 86400, 604800] as const;

export const createInviteRequestSchema = z.object({
  maxAgeSeconds: z
    .number()
    .int()
    .refine(
      (value): value is (typeof INVITE_MAX_AGE_SECONDS)[number] =>
        (INVITE_MAX_AGE_SECONDS as readonly number[]).includes(value),
      "The invite lifetime must be one of the allowed values.",
    )
    .default(604800),
  maxUses: z.number().int().min(0).max(100).default(0),
});
export type CreateInviteRequest = z.infer<typeof createInviteRequestSchema>;

export const inviteSchema = z.object({
  code: z.string(),
  guildId: idSchema,
  channelId: idSchema,
  inviterId: idSchema,
  maxUses: z.number().int().nullable(),
  uses: z.number().int(),
  expiresAt: z.string().nullable(),
});
export type InviteJson = z.infer<typeof inviteSchema>;

export const invitePreviewSchema = z.object({
  code: z.string(),
  guild: z.object({ id: idSchema, name: z.string(), iconKey: z.string().nullable() }),
  channel: z.object({ id: idSchema, name: z.string().nullable() }),
  inviter: z.object({
    id: idSchema,
    username: z.string(),
    displayName: z.string(),
    avatarKey: z.string().nullable(),
  }),
  memberCount: z.number().int(),
  expiresAt: z.string().nullable(),
});
export type InvitePreview = z.infer<typeof invitePreviewSchema>;

export const acceptInviteResultSchema = z.object({
  guild: guildViewSchema,
});
export type AcceptInviteResult = z.infer<typeof acceptInviteResultSchema>;

export const deviceSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  lastSeen: z.string(),
  current: z.boolean(),
});
export type DeviceSummaryJson = z.infer<typeof deviceSummarySchema>;
