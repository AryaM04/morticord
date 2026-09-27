// Token helpers: the access token (JWT), the refresh token, and device IDs.
// See docs/architecture.md section 4 and docs/concepts/auth.md for the design.
import { randomBytes, createHash } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const EMAIL_VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const RESET_PASSWORD_TOKEN_TTL_MS = 60 * 60 * 1000;

export interface AccessTokenClaims {
  userId: bigint;
  deviceId: string;
}

export interface SignedAccessToken {
  accessToken: string;
  accessTokenExpiresAt: Date;
}

/** Make a random device ID: 16 base64url characters (12 random bytes). */
export function generateDeviceId(): string {
  return randomBytes(12).toString("base64url");
}

/** Make a new random, single-use token: 32 random bytes in base64url text. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Hash an opaque token with SHA-256. The server stores only this hash. */
export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Alias of generateOpaqueToken, used where the token is a refresh token. */
export const generateRefreshToken = generateOpaqueToken;
/** Alias of hashOpaqueToken, used where the token is a refresh token. */
export const hashRefreshToken = hashOpaqueToken;

/** Sign a 15-minute access token with the user ID and the device ID as claims. */
export async function signAccessToken(
  jwtSecret: string,
  claims: AccessTokenClaims,
): Promise<SignedAccessToken> {
  const secretKey = new TextEncoder().encode(jwtSecret);
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000);

  const accessToken = await new SignJWT({ did: claims.deviceId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId.toString())
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secretKey);

  return { accessToken, accessTokenExpiresAt: expiresAt };
}

/** Verify an access token. Throw when it is missing, expired or malformed. */
export async function verifyAccessToken(
  jwtSecret: string,
  token: string,
): Promise<AccessTokenClaims> {
  const secretKey = new TextEncoder().encode(jwtSecret);
  const { payload } = await jwtVerify(token, secretKey, { algorithms: ["HS256"] });

  if (typeof payload.sub !== "string" || typeof payload.did !== "string") {
    throw new Error("The access token is missing required claims.");
  }

  return { userId: BigInt(payload.sub), deviceId: payload.did };
}
