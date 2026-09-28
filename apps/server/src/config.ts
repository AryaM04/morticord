// Server configuration, read from environment variables.
// This module fails fast: if a required value is missing or has the wrong
// shape, it throws at startup instead of letting the server run with bad config.
import { z } from "zod";

const envSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(3000),
  POSTGRES_HOST: z.string().min(1),
  POSTGRES_PORT: z.coerce.number().int().positive().default(5432),
  POSTGRES_DB: z.string().min(1),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must have at least 32 characters."),
  TURN_SECRET: z.string().min(1),
  TURN_DOMAIN: z.string().min(1),
  TURN_PORT: z.coerce.number().int().positive().default(3478),
  // The host name or address that voice clients use to reach TURN. It
  // defaults to TURN_DOMAIN, so most deployments need not set it. An
  // empty value (the common case in a copied .env.example) also falls
  // back to the default, the same as leaving the variable unset.
  TURN_PUBLIC_HOST: z.string().optional(),
  // Set to "true" to also offer a `turns:` (TURN over TLS) URL.
  TURN_TLS_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  TURN_TLS_PORT: z.coerce.number().int().positive().default(5349),

  // Origin of the web app. The server puts it in email links and OAuth redirects.
  WEB_ORIGIN: z.string().min(1).default("http://localhost:5173"),

  // Directory for files the server keeps on disk, such as avatars.
  DATA_DIR: z.string().min(1).default("./data"),

  // SMTP settings for account email (verification, password reset).
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().min(1),

  // OAuth app credentials. A provider is off when its pair is not set.
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // Browser-visible origin of the API. The server builds OAuth redirect
  // URIs from this value, so it must match what the OAuth app registers.
  PUBLIC_API_URL: z.string().min(1).default("http://localhost:5173"),

  // Base rate limit for auth routes, in requests per minute per IP. Some
  // routes scale this value up or down; see authRateLimit in app config.
  // Raise this in a test environment to avoid 429s from repeated test runs.
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
});

export interface AppConfig {
  apiPort: number;
  databaseUrl: string;
  jwtSecret: string;
  turnSecret: string;
  turnDomain: string;
  turnPort: number;
  turnPublicHost: string;
  turnTlsEnabled: boolean;
  turnTlsPort: number;
  webOrigin: string;
  dataDir: string;
  smtp: {
    host: string;
    port: number;
    user?: string;
    password?: string;
    from: string;
  };
  oauth: {
    github?: { clientId: string; clientSecret: string };
    google?: { clientId: string; clientSecret: string };
  };
  publicApiUrl: string;
  // Rate limits for auth routes, in requests per minute per IP. Each field
  // scales from AUTH_RATE_LIMIT_PER_MINUTE, so one env var tunes all of them.
  authRateLimit: {
    register: number;
    login: number;
    refresh: number;
    resendVerification: number;
    forgotPassword: number;
  };
}

/** Read and check the process environment. Throw a clear error on bad input. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Server config is not valid. Fix these values: ${issues}`);
  }

  const data = parsed.data;
  const databaseUrl = `postgres://${data.POSTGRES_USER}:${data.POSTGRES_PASSWORD}@${data.POSTGRES_HOST}:${data.POSTGRES_PORT}/${data.POSTGRES_DB}`;

  const oauth: AppConfig["oauth"] = {};
  if (data.GITHUB_CLIENT_ID && data.GITHUB_CLIENT_SECRET) {
    oauth.github = { clientId: data.GITHUB_CLIENT_ID, clientSecret: data.GITHUB_CLIENT_SECRET };
  }
  if (data.GOOGLE_CLIENT_ID && data.GOOGLE_CLIENT_SECRET) {
    oauth.google = { clientId: data.GOOGLE_CLIENT_ID, clientSecret: data.GOOGLE_CLIENT_SECRET };
  }

  return {
    apiPort: data.API_PORT,
    databaseUrl,
    jwtSecret: data.JWT_SECRET,
    turnSecret: data.TURN_SECRET,
    turnDomain: data.TURN_DOMAIN,
    turnPort: data.TURN_PORT,
    turnPublicHost: data.TURN_PUBLIC_HOST && data.TURN_PUBLIC_HOST.length > 0 ? data.TURN_PUBLIC_HOST : data.TURN_DOMAIN,
    turnTlsEnabled: data.TURN_TLS_ENABLED ?? false,
    turnTlsPort: data.TURN_TLS_PORT,
    webOrigin: data.WEB_ORIGIN,
    dataDir: data.DATA_DIR,
    smtp: {
      host: data.SMTP_HOST,
      port: data.SMTP_PORT,
      user: data.SMTP_USER,
      password: data.SMTP_PASSWORD,
      from: data.SMTP_FROM,
    },
    oauth,
    publicApiUrl: data.PUBLIC_API_URL,
    authRateLimit: {
      register: data.AUTH_RATE_LIMIT_PER_MINUTE,
      login: data.AUTH_RATE_LIMIT_PER_MINUTE,
      refresh: data.AUTH_RATE_LIMIT_PER_MINUTE * 3,
      resendVerification: Math.max(1, Math.round(data.AUTH_RATE_LIMIT_PER_MINUTE / 2)),
      forgotPassword: data.AUTH_RATE_LIMIT_PER_MINUTE,
    },
  };
}
