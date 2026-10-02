import { seedDevelopment } from "./seed";
if (
  process.env.APP_ENV !== "development" ||
  process.env.ALLOW_DEV_SEED !== "true"
)
  throw new Error(
    "Seeding requires APP_ENV=development and ALLOW_DEV_SEED=true",
  );
const url = process.env.DATABASE_MIGRATION_URL;
if (!url)
  throw new Error("Set DATABASE_MIGRATION_URL for the development database");
try {
  await seedDevelopment(url);
  console.log("Synthetic development fixtures seeded");
} catch {
  console.error("Seeding failed. No connection details were logged.");
  process.exitCode = 1;
}
