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
  JWT_SECRET: z.string().min(1),
  TURN_SECRET: z.string().min(1),
  TURN_DOMAIN: z.string().min(1),
  TURN_PORT: z.coerce.number().int().positive().default(3478),
});

export interface AppConfig {
  apiPort: number;
  databaseUrl: string;
  jwtSecret: string;
  turnSecret: string;
  turnDomain: string;
  turnPort: number;
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

  return {
    apiPort: data.API_PORT,
    databaseUrl,
    jwtSecret: data.JWT_SECRET,
    turnSecret: data.TURN_SECRET,
    turnDomain: data.TURN_DOMAIN,
    turnPort: data.TURN_PORT,
  };
}
