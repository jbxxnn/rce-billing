import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

/** Use a direct administrative connection, never Hyperdrive's transaction pool. */
export async function migrateDatabase(connectionString: string) {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    application_name: "rce-billing-migrations",
  });
  try {
    await client.connect();
    await client.query("SELECT pg_advisory_lock(7242301)");
    await migrate(drizzle(client), { migrationsFolder: "src/db/migrations" });
  } finally {
    // Disconnect also releases the session advisory lock on failure.
    await client.end();
  }
}
