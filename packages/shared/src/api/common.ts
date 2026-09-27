// Shared pieces used by more than one API schema.
import { z } from "zod";

/** A snowflake ID. The wire form is a decimal string, not a JSON number. */
export const idSchema = z.string().regex(/^[0-9]+$/, "This is not a valid id.");

/** The shape of every error response. The code is stable; the message can change. */
export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    issues: z.array(z.record(z.string(), z.unknown())).optional(),
    /** Set on a 429 response: how long to wait before trying again, in milliseconds. */
    retryAfterMs: z.number().int().nonnegative().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
