// Request and response schemas for direct messages (DMs) and group DMs.
import { z } from "zod";
import { idSchema } from "./common.js";
import { userSchema } from "./auth.js";

/** The most people in one group DM, the owner included. */
export const MAX_GROUP_DM_MEMBERS = 10;

export const dmChannelTypeSchema = z.enum(["dm", "group_dm"]);
export type DmChannelType = z.infer<typeof dmChannelTypeSchema>;

export const groupDmNameSchema = z
  .string()
  .trim()
  .min(1, "The group name must have at least 1 character.")
  .max(100, "The group name must have at most 100 characters.");

/** A DM or group DM, with every person in it (the signed-in user too). */
export const dmChannelSchema = z.object({
  id: idSchema,
  type: dmChannelTypeSchema,
  /** The group name. Always null for a 1:1 DM. */
  name: z.string().nullable(),
  /** The group owner. Always null for a 1:1 DM. */
  ownerId: idSchema.nullable(),
  recipients: z.array(userSchema),
  /** The newest timeline event in this channel, for cheap unread state. */
  lastEventId: idSchema.nullable(),
});
export type DmChannelJson = z.infer<typeof dmChannelSchema>;

/** One id opens a 1:1 DM. Two to nine ids make a group DM. */
export const createDmRequestSchema = z.object({
  recipientIds: z
    .array(idSchema)
    .min(1, "Give at least 1 recipient.")
    .max(MAX_GROUP_DM_MEMBERS - 1, `Give at most ${MAX_GROUP_DM_MEMBERS - 1} recipients.`)
    .refine((ids) => new Set(ids).size === ids.length, "Each recipient can appear only once."),
});
export type CreateDmRequest = z.infer<typeof createDmRequestSchema>;

export const listDmChannelsResponseSchema = z.object({
  channels: z.array(dmChannelSchema),
});
export type ListDmChannelsResponse = z.infer<typeof listDmChannelsResponseSchema>;

export const updateGroupDmRequestSchema = z.object({
  name: groupDmNameSchema.nullable().optional(),
});
export type UpdateGroupDmRequest = z.infer<typeof updateGroupDmRequestSchema>;

/** Sent to the other people in a group DM when someone joins it. */
export const channelRecipientAddPayloadSchema = z.object({ channelId: idSchema, user: userSchema });
/** Sent to the other people in a group DM when someone leaves it or is removed. */
export const channelRecipientRemovePayloadSchema = z.object({ channelId: idSchema, userId: idSchema });

/** Sent to the other people in a DM when a call starts. */
export const callRingPayloadSchema = z.object({ channelId: idSchema, userId: idSchema });
/** Sent when a call stops ringing. */
export const callRingStopPayloadSchema = z.object({ channelId: idSchema });
