// The link preview route of the web client. A browser cannot fetch other
// sites (CORS), so the web client asks its own server. A desktop client
// fetches the page itself and does not use this route. See
// docs/concepts/link-previews.md.
import { z } from "zod";
import { base64UrlSchema, webUrlSchema } from "./messages.js";

export const linkPreviewRequestSchema = z.object({ url: webUrlSchema });
export type LinkPreviewRequest = z.infer<typeof linkPreviewRequestSchema>;

/** The image types that a link preview can have. */
export const LINK_PREVIEW_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

export const linkPreviewResponseSchema = z.object({
  /** The URL of the page after redirects. */
  url: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  siteName: z.string().optional(),
  /** The preview image, as base64url bytes. */
  image: z.object({ mime: z.enum(LINK_PREVIEW_IMAGE_TYPES), data: base64UrlSchema }).optional(),
});
export type LinkPreviewResponse = z.infer<typeof linkPreviewResponseSchema>;
