// The desktop download route: GET /api/v1/desktop/latest. The server reads
// the latest release of the project from GitHub and lists the installers.
import { z } from "zod";

export const desktopPlatformSchema = z.enum(["windows", "macos", "linux"]);
export type DesktopPlatform = z.infer<typeof desktopPlatformSchema>;

export const desktopAssetKindSchema = z.enum(["installer", "msi", "dmg", "appimage", "deb"]);
export type DesktopAssetKind = z.infer<typeof desktopAssetKindSchema>;

export const desktopAssetSchema = z.object({
  platform: desktopPlatformSchema,
  kind: desktopAssetKindSchema,
  name: z.string(),
  /** The size in bytes. */
  size: z.number().int().nonnegative(),
  url: z.string().url(),
});
export type DesktopAsset = z.infer<typeof desktopAssetSchema>;

export const desktopLatestResponseSchema = z.object({
  version: z.string(),
  publishedAt: z.string(),
  notesUrl: z.string().url(),
  assets: z.array(desktopAssetSchema),
  /** True when the server could not reach GitHub and sends an older result. */
  stale: z.boolean().optional(),
});
export type DesktopLatestResponse = z.infer<typeof desktopLatestResponseSchema>;
