import { Client } from "pg";
const url = process.env.DATABASE_MIGRATION_URL;
if (!url) throw new Error("DATABASE_MIGRATION_URL is required");
const client = new Client({ connectionString: url });
try {
  await client.connect();
  await client.query(
    "DELETE FROM app_sessions WHERE id IN (SELECT id FROM app_sessions WHERE expires_at <= now() LIMIT 1000)",
  );
  await client.query(
    "DELETE FROM auth_rate_limits WHERE key IN (SELECT key FROM auth_rate_limits WHERE expires_at <= now() LIMIT 1000)",
  );
  console.log(
    "Expired authentication records cleaned up (up to 1,000 per table).",
  );
} catch {
  console.error("Authentication cleanup failed.");
  process.exitCode = 1;
} finally {
  await client.end();
}
