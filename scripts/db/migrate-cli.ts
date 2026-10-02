import dotenv from "dotenv";
import { migrateDatabase } from "./migrate";

dotenv.config({ path: ".env.local" });

const url = process.env.DATABASE_MIGRATION_URL;
if (!url)
  throw new Error(
    "Set DATABASE_MIGRATION_URL to the target database's direct connection",
  );
try {
  await migrateDatabase(url);
  console.log("Database migrations applied successfully");
} catch (error) {
  console.error("Database migration failed:");
  console.error(error);
  process.exitCode = 1;
}
