// Typed REST wrappers for the synced user settings. The server keeps the
// bytes as they are. The client stores JSON now and encrypts it in M6.
import {
  decodeBase64Url,
  encodeBase64Url,
  putSettingsRequestSchema,
  settingsResponseSchema,
  type SettingsResponse,
} from "@discord-clone/shared";
import type { ApiClient } from "./api.js";

export function getSettings(api: ApiClient): Promise<SettingsResponse> {
  return api.request<SettingsResponse>("GET", "/users/@me/settings", { schema: settingsResponseSchema });
}

/**
 * Save the settings bytes. `version` is the version of the last read or save.
 * The call fails with the code VERSION_CONFLICT when another device saved first.
 */
export function putSettings(api: ApiClient, bytes: Uint8Array, version: number): Promise<SettingsResponse> {
  const body = putSettingsRequestSchema.parse({ data: encodeBase64Url(bytes), version });
  return api.request<SettingsResponse>("PUT", "/users/@me/settings", { body, schema: settingsResponseSchema });
}

/** Decode the `data` of a settings response. Returns null when the user never saved settings. */
export function settingsBytes(response: SettingsResponse): Uint8Array | null {
  return response.data === null ? null : decodeBase64Url(response.data);
}
