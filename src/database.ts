import pg from "pg";
import { env } from "./config/env.js";

const { Pool } = pg;

export const database = env.databaseUrl
  ? new Pool({
      connectionString: env.databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000
    })
  : null;

// pg emits errors from idle clients separately from the query that created them.
// Attach a listener so transient connection failures are logged instead of becoming
// an unhandled EventEmitter error that can terminate the API process.
database?.on("error", (error: Error) => {
  console.error("Unexpected idle PostgreSQL client error:", error);
});
