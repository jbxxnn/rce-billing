import "server-only";
export function databaseSource() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Database is not configured");
  return { connectionString };
}
