// Request and response schemas for the key server and the to-device queue.
// See docs/concepts/olm-megolm.md sections 3, 4 and 6.
import { z } from "zod";
import { idSchema } from "./common.js";
import { base64UrlSchema } from "./messages.js";

/** A Curve25519 or Ed25519 public key: 32 bytes as unpadded standard base64. */
export const publicKeySchema = z.string().regex(/^[A-Za-z0-9+/]{43}$/, "This is not a valid public key.");
/** An Ed25519 signature: 64 bytes as unpadded standard base64. */
export const signatureSchema = z.string().regex(/^[A-Za-z0-9+/]{86}$/, "This is not a valid signature.");
/** A one-time key id, as vodozemac writes it. */
export const keyIdSchema = z.string().regex(/^[A-Za-z0-9+/_-]{1,32}$/, "This is not a valid key id.");
/** A device id, as the server makes it (base64url). */
export const deviceIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "This is not a valid device id.");

/** The server keeps at most this many one-time keys for each device. */
export const MAX_STORED_ONE_TIME_KEYS = 100;
/** The largest to-device ciphertext, in bytes once decoded. */
export const MAX_TO_DEVICE_BYTES = 64 * 1024;
/** The most to-device messages in one request. */
export const MAX_TO_DEVICE_MESSAGES = 100;
/** The most users in one key query, and the most devices in one claim. */
export const MAX_KEY_QUERY_ITEMS = 500;

export const deviceKeysSchema = z.object({
  curve25519: publicKeySchema,
  ed25519: publicKeySchema,
  /** The device Ed25519 key signs `deviceKeysSignedText`. */
  signature: signatureSchema,
});
export type DeviceKeys = z.infer<typeof deviceKeysSchema>;

export const signedKeySchema = z.object({ key: publicKeySchema, signature: signatureSchema });

export const uploadKeysRequestSchema = z.object({
  deviceKeys: deviceKeysSchema.optional(),
  oneTimeKeys: z
    .record(keyIdSchema, signedKeySchema)
    .refine((keys) => Object.keys(keys).length <= MAX_STORED_ONE_TIME_KEYS, "Too many one-time keys.")
    .optional(),
  fallbackKey: signedKeySchema.extend({ keyId: keyIdSchema }).optional(),
  /** The master key of the user signs the device keys of this device. */
  masterSignature: signatureSchema.optional(),
});
export type UploadKeysRequest = z.infer<typeof uploadKeysRequestSchema>;

export const uploadKeysResponseSchema = z.object({
  oneTimeKeyCount: z.number().int().nonnegative(),
  /** True when the device has no fallback key, or when a claim used it. */
  needsFallbackKey: z.boolean(),
});
export type UploadKeysResponse = z.infer<typeof uploadKeysResponseSchema>;

export const putMasterKeyRequestSchema = z.object({
  publicKey: publicKeySchema,
  /** The Ed25519 key of the calling device signs `masterKeySignedText`. */
  deviceSignature: signatureSchema,
  /** The master key signs the device keys of the calling device. */
  masterSignature: signatureSchema,
});
export type PutMasterKeyRequest = z.infer<typeof putMasterKeyRequestSchema>;

export const queryKeysRequestSchema = z.object({
  userIds: z.array(idSchema).min(1).max(MAX_KEY_QUERY_ITEMS),
});
export type QueryKeysRequest = z.infer<typeof queryKeysRequestSchema>;

export const queriedDeviceSchema = deviceKeysSchema.extend({
  deviceId: deviceIdSchema,
  masterSignature: signatureSchema.nullable(),
});
export type QueriedDevice = z.infer<typeof queriedDeviceSchema>;

export const masterKeySchema = z.object({
  publicKey: publicKeySchema,
  /** The device that uploaded the master key, and its signature. */
  deviceId: deviceIdSchema,
  deviceSignature: signatureSchema,
});
export type MasterKey = z.infer<typeof masterKeySchema>;

export const queriedUserSchema = z.object({
  userId: idSchema,
  masterKey: masterKeySchema.nullable(),
  devices: z.array(queriedDeviceSchema),
});
export type QueriedUser = z.infer<typeof queriedUserSchema>;

export const queryKeysResponseSchema = z.object({ users: z.array(queriedUserSchema) });
export type QueryKeysResponse = z.infer<typeof queryKeysResponseSchema>;

export const deviceRefSchema = z.object({ userId: idSchema, deviceId: deviceIdSchema });
export type DeviceRef = z.infer<typeof deviceRefSchema>;

export const claimKeysRequestSchema = z.object({
  devices: z.array(deviceRefSchema).min(1).max(MAX_KEY_QUERY_ITEMS),
});
export type ClaimKeysRequest = z.infer<typeof claimKeysRequestSchema>;

export const claimedKeySchema = deviceRefSchema.extend({
  keyId: keyIdSchema,
  key: publicKeySchema,
  signature: signatureSchema,
  /** True when the device had no one-time key left and this is its fallback key. */
  fallback: z.boolean(),
});
export type ClaimedKey = z.infer<typeof claimedKeySchema>;

export const claimKeysResponseSchema = z.object({ keys: z.array(claimedKeySchema) });
export type ClaimKeysResponse = z.infer<typeof claimKeysResponseSchema>;

// Base64url of 64 KiB is at most this many characters.
const MAX_TO_DEVICE_CHARS = Math.ceil((MAX_TO_DEVICE_BYTES * 4) / 3);

export const toDeviceMessageSchema = deviceRefSchema.extend({
  /** The outer type the server sees. The real event type is inside the ciphertext. */
  type: z.string().regex(/^[a-z0-9.]{1,32}$/, "This is not a valid message type."),
  ciphertext: base64UrlSchema.min(1).max(MAX_TO_DEVICE_CHARS, `The ciphertext must be at most ${MAX_TO_DEVICE_BYTES} bytes.`),
});
export type ToDeviceMessage = z.infer<typeof toDeviceMessageSchema>;

export const sendToDeviceRequestSchema = z.object({
  messages: z.array(toDeviceMessageSchema).min(1).max(MAX_TO_DEVICE_MESSAGES),
});
export type SendToDeviceRequest = z.infer<typeof sendToDeviceRequestSchema>;

export const sendToDeviceResponseSchema = z.object({
  /** Devices that do not exist, were removed or have no keys. The server stored nothing for them. */
  skipped: z.array(deviceRefSchema),
});
export type SendToDeviceResponse = z.infer<typeof sendToDeviceResponseSchema>;

/** Sent by the server: one queued to-device message for this device. */
export const toDeviceDispatchPayloadSchema = z.object({
  id: idSchema,
  senderUserId: idSchema,
  senderDeviceId: deviceIdSchema,
  type: z.string(),
  ciphertext: base64UrlSchema,
  createdAt: z.string(),
});
export type ToDeviceDispatchPayload = z.infer<typeof toDeviceDispatchPayloadSchema>;

/**
 * Sent by the client: every message up to `upToId` is processed, so the
 * server can delete it. With `resync`, the server also sends again every
 * message after `upToId`.
 */
export const toDeviceAckPayloadSchema = z.object({
  upToId: idSchema,
  resync: z.boolean().optional(),
});
export type ToDeviceAckPayload = z.infer<typeof toDeviceAckPayloadSchema>;

/** Sent by the server when the devices or the master key of a user change. */
export const deviceListUpdatePayloadSchema = z.object({ userId: idSchema });
export type DeviceListUpdatePayload = z.infer<typeof deviceListUpdatePayloadSchema>;
