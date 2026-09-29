// Request and response schemas for friends and blocks. See
// docs/concepts/dms-and-friends.md for the model.
import { z } from "zod";
import { idSchema } from "./common.js";
import { userSchema, usernameSchema } from "./auth.js";

/** The most friend requests one user can send in one minute. */
export const MAX_FRIEND_REQUESTS_PER_MINUTE = 10;

/**
 * How the signed-in user relates to one other user. Each direction has its
 * own row on the server. `blocked` shows only to the user who blocked.
 */
export const relationshipStatusSchema = z.enum(["pending_outgoing", "pending_incoming", "accepted", "blocked"]);
export type RelationshipStatus = z.infer<typeof relationshipStatusSchema>;

export const relationshipSchema = z.object({
  userId: idSchema,
  status: relationshipStatusSchema,
  user: userSchema,
});
export type RelationshipJson = z.infer<typeof relationshipSchema>;

export const listRelationshipsResponseSchema = z.object({
  relationships: z.array(relationshipSchema),
});
export type ListRelationshipsResponse = z.infer<typeof listRelationshipsResponseSchema>;

export const sendFriendRequestSchema = z.object({
  username: usernameSchema,
});
export type SendFriendRequest = z.infer<typeof sendFriendRequestSchema>;

export const relationshipActionRequestSchema = z.object({
  action: z.enum(["accept", "block"]),
});
export type RelationshipActionRequest = z.infer<typeof relationshipActionRequestSchema>;

/** Sent by the server when a relationship is made or changes. */
export const relationshipAddPayloadSchema = relationshipSchema;
/** Sent by the server when a relationship ends. */
export const relationshipRemovePayloadSchema = z.object({ userId: idSchema });
export type RelationshipRemovePayload = z.infer<typeof relationshipRemovePayloadSchema>;
