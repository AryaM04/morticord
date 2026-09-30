// Database connection, built from the loaded config.
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { AppConfig } from "../config.js";
import * as schema from "./schema.js";

export function createDbClient(config: AppConfig) {
  const sql = postgres(config.databaseUrl);
  return drizzle(sql, { schema });
}

export type DbClient = ReturnType<typeof createDbClient>;

/**
 * True when a database error is a unique violation (code 23505). Drizzle
 * puts the Postgres error in `cause`, so this function reads both places.
 * With `constraintPart`, the name of the constraint must contain that text.
 */
export function isUniqueViolation(error: unknown, constraintPart?: string): boolean {
  for (const candidate of [error, (error as { cause?: unknown } | null)?.cause]) {
    const pgError = candidate as { code?: string; constraint_name?: string } | null | undefined;
    if (pgError?.code === "23505") {
      return constraintPart === undefined || (pgError.constraint_name?.includes(constraintPart) ?? false);
    }
  }
  return false;
}
