import "server-only";
import { databaseSource } from "@runtime/database";
import { withDatabase } from "../db/client";
import { planManagementRepository } from "../db/repositories/plan-management";
import { requireAdministrator } from "../auth/server";
export async function withPlans<T>(
  work: (repository: ReturnType<typeof planManagementRepository>) => Promise<T>,
) {
  await requireAdministrator();
  return withDatabase(databaseSource(), (db) =>
    work(planManagementRepository(db)),
  );
}
