import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import pg, { type PoolClient } from "pg";
import { env } from "../config/env.js";

const { Pool } = pg;

type Migration = {
  filename: string;
  checksum: string;
  sql: string;
};

const migrationDirectory = resolve(process.cwd(), "database/migrations");
const baselineMigrations = [
  "001_initial_schema.sql",
  "002_single_admin_sessions.sql"
] as const;

function stripTransactionWrapper(sql: string): string {
  return sql
    .split(/\r?\n/)
    .filter((line) => !/^\s*(BEGIN|COMMIT);?\s*$/i.test(line))
    .join("\n");
}

async function loadMigrations(): Promise<Migration[]> {
  const filenames = (await readdir(migrationDirectory))
    .filter((filename) => /^\d+_[a-z0-9_-]+\.sql$/i.test(filename))
    .sort();

  if (filenames.length === 0) {
    throw new Error("No database migration files were found.");
  }

  return Promise.all(filenames.map(async (filename) => {
    const sql = await readFile(resolve(migrationDirectory, filename), "utf8");
    return {
      filename,
      checksum: createHash("sha256").update(sql).digest("hex"),
      sql: stripTransactionWrapper(sql)
    };
  }));
}

async function detectExistingSchema(client: PoolClient): Promise<"empty" | "complete" | "partial"> {
  const expectedTables = [
    "admins",
    "photos",
    "photo_likes",
    "photo_comments",
    "announcements",
    "push_subscriptions",
    "push_subscription_channels",
    "admin_sessions"
  ];

  const tables = await client.query<{ object_name: string; exists: boolean }>(
    `SELECT object_name,
            to_regclass('public.' || quote_ident(object_name)) IS NOT NULL AS exists
       FROM unnest($1::text[]) AS names(object_name)`,
    [expectedTables]
  );
  const enumResult = await client.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_channel') AS exists"
  );
  const singleAdminIndex = await client.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'admins_single_account_only') AS exists"
  );

  const existingCount = tables.rows.filter((row) => row.exists).length;
  const hasAnySchema = existingCount > 0 || enumResult.rows[0]?.exists === true;
  if (!hasAnySchema) return "empty";

  const allTablesExist = existingCount === expectedTables.length;
  const enumExists = enumResult.rows[0]?.exists === true;
  const indexExists = singleAdminIndex.rows[0]?.exists === true;

  return allTablesExist && enumExists && indexExists ? "complete" : "partial";
}

async function main(): Promise<void> {
  if (!env.databaseUrl) {
    throw new Error("DATABASE_URL is required to run database migrations.");
  }

  const migrations = await loadMigrations();
  const migrationByName = new Map(migrations.map((migration) => [migration.filename, migration]));
  for (const required of baselineMigrations) {
    if (!migrationByName.has(required)) {
      throw new Error(`Required baseline migration is missing: ${required}`);
    }
  }

  const pool = new Pool({
    connectionString: env.databaseUrl,
    max: 1,
    connectionTimeoutMillis: 10_000
  });
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        checksum CHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const recorded = await client.query<{ filename: string; checksum: string }>(
      "SELECT filename, checksum FROM schema_migrations ORDER BY filename"
    );

    if (recorded.rowCount === 0) {
      const schemaState = await detectExistingSchema(client);
      if (schemaState === "partial") {
        throw new Error(
          "A partial pre-migration schema was detected. Refusing to guess or modify it; inspect the database before proceeding."
        );
      }

      if (schemaState === "complete") {
        await client.query("BEGIN");
        try {
          for (const filename of baselineMigrations) {
            const migration = migrationByName.get(filename)!;
            await client.query(
              "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)",
              [migration.filename, migration.checksum]
            );
          }
          await client.query("COMMIT");
          console.log("Recognized the existing database and recorded migrations 001 and 002 as baseline.");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      }
    }

    const applied = new Map(recorded.rows.map((row) => [row.filename, row.checksum]));
    if (recorded.rowCount === 0) {
      const baselineRows = await client.query<{ filename: string; checksum: string }>(
        "SELECT filename, checksum FROM schema_migrations"
      );
      for (const row of baselineRows.rows) applied.set(row.filename, row.checksum);
    }

    for (const migration of migrations) {
      const existingChecksum = applied.get(migration.filename);
      if (existingChecksum) {
        if (existingChecksum !== migration.checksum) {
          throw new Error(
            `Migration checksum mismatch for ${migration.filename}. Applied migrations must not be edited.`
          );
        }
        console.log(`Already applied: ${migration.filename}`);
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)",
          [migration.filename, migration.checksum]
        );
        await client.query("COMMIT");
        console.log(`Applied: ${migration.filename}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    console.log("Database migrations are up to date.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("Database migration failed:", error);
  process.exitCode = 1;
});
