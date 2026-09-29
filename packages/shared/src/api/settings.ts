// Request and response schemas for the synced user settings. The server
// stores the bytes as they are. From milestone M6 the client encrypts them.
import { z } from "zod";
import { decodeBase64Url } from "../base64.js";
import { base64UrlSchema } from "./messages.js";

/** The largest settings blob, in bytes once decoded. */
export const MAX_SETTINGS_BYTES = 64 * 1024;

export const settingsDataSchema = base64UrlSchema.refine(
  (value) => {
    try {
      return decodeBase64Url(value).length <= MAX_SETTINGS_BYTES;
    } catch {
      return false;
    }
  },
  `The settings must be at most ${MAX_SETTINGS_BYTES} bytes once decoded.`,
);

export const settingsResponseSchema = z.object({
  /** Base64url bytes, or null when the user never saved settings. */
  data: settingsDataSchema.nullable(),
  /** 0 when the user never saved settings. Each save adds 1. */
  version: z.number().int().nonnegative(),
});
export type SettingsResponse = z.infer<typeof settingsResponseSchema>;

export const putSettingsRequestSchema = z.object({
  data: settingsDataSchema,
  /** The version the client last read. The save fails with 409 when it is old. */
  version: z.number().int().nonnegative(),
});
export type PutSettingsRequest = z.infer<typeof putSettingsRequestSchema>;

/** Sent to the other sessions of a user after one session saves settings. */
export const userSettingsUpdatePayloadSchema = z.object({
  version: z.number().int().positive(),
});
export type UserSettingsUpdatePayload = z.infer<typeof userSettingsUpdatePayloadSchema>;
