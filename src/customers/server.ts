import "server-only";
import { databaseSource } from "@runtime/database";
import { withDatabase } from "../db/client";
import { customerManagementRepository } from "../db/repositories/customer-management";
import { requireAdministrator } from "../auth/server";
export async function withCustomers<T>(
  work: (
    repository: ReturnType<typeof customerManagementRepository>,
  ) => Promise<T>,
) {
  await requireAdministrator();
  return withDatabase(databaseSource(), (db) =>
    work(customerManagementRepository(db)),
  );
}
