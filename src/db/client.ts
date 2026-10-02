import "server-only";
import { Client } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;
export type DatabaseSource = { connectionString: string };

/** Pass env.HYPERDRIVE in Workers, or a server-only local DATABASE_URL wrapper.
 * Hyperdrive owns pooling; never share live Clients between Worker requests.
 */
export async function withDatabase<T>(
  source: DatabaseSource,
  work: (db: Database) => Promise<T>,
): Promise<T> {
  if (!source.connectionString)
    throw new Error("Database connection is not configured");
  const client = new Client({
    connectionString: source.connectionString,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    application_name: "rce-billing",
  });
  try {
    await client.connect();
    return await work(drizzle(client, { schema }));
  } finally {
    await client.end();
  }
}
