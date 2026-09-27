// Request and response schemas for the users module.
import { z } from "zod";
import { displayNameSchema, userSchema } from "./auth.js";

export const statusTextSchema = z
  .string()
  .trim()
  .max(128, "The status text must have at most 128 characters.");

export const updateMeRequestSchema = z.object({
  displayName: displayNameSchema.optional(),
  statusText: statusTextSchema.nullable().optional(),
});
export type UpdateMeRequest = z.infer<typeof updateMeRequestSchema>;

export const meResultSchema = userSchema;
export type MeResult = z.infer<typeof meResultSchema>;
