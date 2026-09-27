// Request and response schemas for the auth module.
// The server validates requests with these schemas. A client parses
// responses with the same schemas, so both sides agree on the shape.
import { z } from "zod";
import { idSchema } from "./common.js";

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "The username must have at least 2 characters.")
  .max(32, "The username must have at most 32 characters.")
  .regex(
    /^[a-z0-9_.]+$/,
    "The username can have only lowercase letters, digits, the underscore and the dot.",
  );

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "The display name must have at least 1 character.")
  .max(32, "The display name must have at most 32 characters.");

export const passwordSchema = z
  .string()
  .min(8, "The password must have at least 8 characters.")
  .max(128, "The password must have at most 128 characters.");

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("This is not a valid email address.");

export const oauthProviderSchema = z.enum(["github", "google"]);
export type OAuthProvider = z.infer<typeof oauthProviderSchema>;

/** A user, as the server sends it in a JSON body. */
export const userSchema = z.object({
  id: idSchema,
  username: usernameSchema,
  displayName: displayNameSchema,
  email: emailSchema.optional(),
  emailVerified: z.boolean().optional(),
  avatarKey: z.string().nullable(),
  statusText: z.string().nullable(),
  createdAt: z.string(),
});
export type User = z.infer<typeof userSchema>;

/** The response of every route that starts or continues a session. */
export const authResultSchema = z.object({
  user: userSchema,
  deviceId: z.string(),
  accessToken: z.string(),
  accessTokenExpiresAt: z.string(),
  refreshToken: z.string(),
});
export type AuthResult = z.infer<typeof authResultSchema>;

export const registerRequestSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  password: passwordSchema,
  displayName: displayNameSchema.optional(),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "The password is required."),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1, "The refresh token is required."),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const refreshResultSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: z.string(),
  refreshToken: z.string(),
});
export type RefreshResult = z.infer<typeof refreshResultSchema>;

export const verifyEmailRequestSchema = z.object({
  token: z.string().min(1, "The verification token is required."),
});
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;

export const forgotPasswordRequestSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(1, "The reset token is required."),
  password: passwordSchema,
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

export const oauthProvidersResultSchema = z.object({
  providers: z.array(oauthProviderSchema),
});
export type OAuthProvidersResult = z.infer<typeof oauthProvidersResultSchema>;

export const oauthExchangeRequestSchema = z.object({
  code: z.string().min(1, "The exchange code is required."),
});
export type OAuthExchangeRequest = z.infer<typeof oauthExchangeRequestSchema>;
