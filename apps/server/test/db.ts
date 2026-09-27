// Test helper: make a fresh Postgres database, run the migrations, and
// drop the database again at the end. See docs/architecture.md section 6.
//
// TEST_DATABASE_URL must point at a server where the test user can create
// and drop databases. When it is not set, call `describeWithDb` instead of
// `describe`, and the suite skips with a clear message.
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { describe } from "vitest";
import * as schema from "../src/db/schema.js";
import type { DbClient } from "../src/db/client.js";

const migrationsFolder = path.join(fileURLToPath(new URL(".", import.meta.url)), "../drizzle");

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

export interface TestDb {
  db: DbClient;
  close(): Promise<void>;
}

/** Make one fresh database, migrate it, and return a client and a closer. */
export async function createTestDb(): Promise<TestDb> {
  if (!TEST_DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL is not set. Integration tests need it.");
  }

  const dbName = `test_${randomBytes(6).toString("hex")}`;
  const adminSql = postgres(TEST_DATABASE_URL, { max: 1 });
  try {
    await adminSql.unsafe(`CREATE DATABASE ${dbName}`);
  } finally {
    await adminSql.end();
  }

  const testDbUrl = new URL(TEST_DATABASE_URL);
  testDbUrl.pathname = `/${dbName}`;
  const testSql = postgres(testDbUrl.toString());
  const db = drizzle(testSql, { schema });

  await migrate(db, { migrationsFolder });

  return {
    db,
    async close() {
      await testSql.end();
      const cleanupSql = postgres(TEST_DATABASE_URL, { max: 1 });
      try {
        await cleanupSql.unsafe(`DROP DATABASE IF EXISTS ${dbName}`);
      } finally {
        await cleanupSql.end();
      }
    },
  };
}

/**
 * Like `describe`, but skips the whole suite with a clear message when
 * TEST_DATABASE_URL is not set, instead of failing or silently doing
 * nothing.
 */
export function describeWithDb(name: string, fn: () => void): void {
  if (!TEST_DATABASE_URL) {
    describe.skip(`${name} (skipped: set TEST_DATABASE_URL to run)`, fn);
    return;
  }
  describe(name, fn);
}
